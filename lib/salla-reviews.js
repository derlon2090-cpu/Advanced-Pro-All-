const baseUrl = 'https://api.salla.dev/admin/v2/';
const staleAfter = 2 * 60_000;
const identifier = value => /^\d+$/.test(String(value || '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const sameText = (left, right) => String(left || '').normalize('NFC').trim().replace(/\s+/g, ' ')
  === String(right || '').normalize('NFC').trim().replace(/\s+/g, ' ');

async function salla(token, path, method = 'GET', body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body ? {'content-type':'application/json'} : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload || payload.success === false || !Object.hasOwn(payload, 'data')) {
    const permissionMessage = path.startsWith('orders/')
      ? 'سلة لم تسمح بقراءة الطلب. تحقق من صلاحية orders.read لرمز التقييمات.'
      : 'سلة لم تسمح بعملية التقييم. يلزم اعتماد التطبيق وصلاحية reviews.read_write.';
    const message = [401,403].includes(response.status)
      ? permissionMessage
      : response.status === 422 ? 'سلة رفضت بيانات التقييم أو ارتباطه بالطلب.' : 'تعذر تأكيد عملية النشر مع سلة.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return payload;
}

function orderProduct(order, review) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const matching = items.filter(item => sameText(item.name || item.product?.name, review.product_name));
  const candidates = matching.length ? matching : items.length === 1 ? items : [];
  const ids = [...new Set(candidates.map(item => identifier(item.product?.id || item.product_id)).filter(Boolean))];
  if (ids.length !== 1) throw new Error('تعذر تحديد المنتج المرتبط بهذا التقييم في طلب سلة.');
  return ids[0];
}

async function matchingFeedback(token, orderId, customerId, productId) {
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ type:'product', products:String(productId), customers:String(customerId), page:String(page) });
    const { data, pagination } = await salla(token, 'feedbacks?' + query);
    if (!Array.isArray(data)) throw new Error('تعذر التحقق من التقييمات الموجودة في سلة.');
    const found = data.find(item => identifier(item.order_id) === orderId
      && identifier(item.customer?.id || item.customer_id) === customerId
      && identifier(item.product?.id || item.product_id || item.reference_id) === productId);
    if (found) return found;
    const total = Number(pagination?.totalPages ?? pagination?.total_pages ?? 1);
    if (page >= total) return null;
  }
  throw new Error('تعذر التحقق من وجود تقييم سابق في سلة.');
}

export async function publishApprovedReview(db, review) {
  const published = { state:'published', message:'تم نشر التقييم في سلة.', id:review.salla_feedback_id };
  if (review.salla_publish_state === 'published' && review.salla_feedback_id) return published;
  const token = process.env.SALLA_REVIEW_ACCESS_TOKEN || process.env.SALLA_ACCESS_TOKEN;
  const now = new Date().toISOString();
  if (review.salla_publish_state === 'sending' && Date.now() - Date.parse(review.salla_publish_started_at) < staleAfter) {
    return { state:'sending', message:'جاري إرسال التقييم إلى سلة.' };
  }
  const filter = new URLSearchParams({
    id:'eq.' + review.id,
    status:'eq.published',
    salla_publish_state:review.salla_publish_state ? 'eq.' + review.salla_publish_state : 'is.null',
    salla_publish_started_at:review.salla_publish_started_at ? 'eq.' + review.salla_publish_started_at : 'is.null',
  });
  const write = (params, body) => db('order_reviews?' + params, {
    method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(body),
  });
  const claimed = await write(filter, {salla_publish_state:'sending', salla_publish_started_at:now, salla_publish_note:null});
  if (!claimed.ok) return {state:'failed', message:'تعذر تسجيل إرسال التقييم إلى سلة.'};
  if (!(await claimed.json()).length) return {state:'sending', message:'تغيرت حالة التقييم. حدّث القائمة للاطلاع عليها.'};
  const claimedFilter = new URLSearchParams({id:'eq.' + review.id,salla_publish_started_at:'eq.' + now,salla_publish_state:'eq.sending'});
  let feedbackId = identifier(review.salla_feedback_id);
  const finish = async (state, message) => {
    const saved = await write(claimedFilter, {salla_publish_state:state,salla_feedback_id:feedbackId ? String(feedbackId) : null,salla_publish_note:message});
    if (!saved.ok || !(await saved.json()).length) return {state:'check_required',message:'تعذر حفظ نتيجة الإرسال. تحقق من التقييم في سلة قبل إعادة النشر.'};
    return {state,message,id:feedbackId};
  };
  if (!token) return finish('failed','اعتمد التقييم في اللوحة. يلزم إعداد رمز سلة بصلاحية نشر التقييمات.');
  let creationInProgress = false;
  const previousUncertain = ['sending','check_required'].includes(review.salla_publish_state);
  try {
    const orderResult = await db('orders?' + new URLSearchParams({select:'salla_order_id,customers(salla_customer_id)',id:'eq.' + review.order_id,limit:'1'}));
    if (!orderResult.ok) throw new Error('تعذر تحميل الطلب المرتبط بالتقييم.');
    const [order] = await orderResult.json();
    const orderId = identifier(order?.salla_order_id);
    const customer = Array.isArray(order?.customers) ? order.customers[0] : order?.customers;
    const customerId = identifier(customer?.salla_customer_id);
    const rating = Number(review.rating);
    if (!orderId || !customerId || !Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('بيانات الطلب أو العميل أو عدد النجوم غير مكتملة.');
    const text = [...String(review.comment || '').trim()];
    const shortened = text.length > 255;
    const content = shortened ? text.slice(0, 254).join('') + '…' : text.join('');
    const {data: sallaOrder} = await salla(token, 'orders/' + orderId);
    if (identifier(sallaOrder?.id) !== orderId || (sallaOrder.customer?.id && identifier(sallaOrder.customer.id) !== customerId)) {
      throw new Error('لم تتطابق بيانات الطلب والعميل في سلة.');
    }
    const productId = orderProduct(sallaOrder, review);
    let feedback = feedbackId ? (await salla(token, 'feedbacks/' + feedbackId)).data
      : await matchingFeedback(token, orderId, customerId, productId);
    if (!feedback && previousUncertain) return finish('check_required','لم تتأكد نتيجة المحاولة السابقة. راجع التقييمات في سلة لتجنب التكرار.');
    if (!feedback) {
      creationInProgress = true;
      feedback = (await salla(token, 'feedbacks', 'POST', {
        type:'rating', order_id:orderId, customer_id:customerId, product_id:productId, rating, ...(content ? {content} : {}),
      })).data;
    }
    const id = identifier(feedback?.id);
    if (!id || identifier(feedback?.order_id) !== orderId || Number(feedback.rating) !== rating || !sameText(feedback.content, content)) {
      return finish('check_required','يوجد تقييم في سلة تعذر تأكيد مطابقته للنص أو النجوم. راجعه قبل إعادة النشر.');
    }
    feedbackId = id;
    const checkpoint = await write(claimedFilter, {salla_feedback_id:String(id)});
    if (!checkpoint.ok || !(await checkpoint.json()).length) return {state:'check_required',message:'تعذر حفظ معرّف التقييم في سلة. تحقق منه قبل إعادة النشر.'};
    if (feedback.is_published !== true) {
      const {data} = await salla(token, 'feedbacks/' + id, 'PUT', {is_published:true});
      if (data?.is_published !== true) return finish('check_required','استلمت سلة التقييم، ولم تؤكد ظهوره في المتجر.');
    }
    return finish('published', shortened ? 'تم النشر في سلة. اقتُصر النص على 255 حرفًا حسب حد سلة.' : 'تم نشر التقييم في سلة.');
  } catch (error) {
    const uncertain = previousUncertain || (creationInProgress && !feedbackId && ![401,403,422].includes(error.status));
    const message = error.name === 'TimeoutError' || error instanceof TypeError
      ? 'تعذر الاتصال بسلة. تحقق من حالة التقييم قبل إعادة المحاولة.' : error.message;
    return finish(uncertain ? 'check_required' : 'failed', message);
  }
}

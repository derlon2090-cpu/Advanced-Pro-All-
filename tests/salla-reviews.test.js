import test from 'node:test';
import assert from 'node:assert/strict';
import { publishApprovedReview } from '../lib/salla-reviews.js';

async function fixture(t, behavior = 'success') {
  const old = process.env.SALLA_REVIEW_ACCESS_TOKEN;
  process.env.SALLA_REVIEW_ACCESS_TOKEN = 'fixture-token';
  t.after(() => {
    if (old === undefined) delete process.env.SALLA_REVIEW_ACCESS_TOKEN;
    else process.env.SALLA_REVIEW_ACCESS_TOKEN = old;
  });
  const row = {
    id:'fixture-review', order_id:'fixture-order', product_name:'اشتراك تجريبي',
    status:'published', rating:4, comment:'ت'.repeat(270), suggestion_text:'خاص بلوحة الإدارة',
  };
  const calls = [];
  const db = async (path, options = {}) => {
    if (path.startsWith('orders?')) return Response.json([{salla_order_id:'77',customers:{salla_customer_id:'33'}}]);
    assert.match(path, /^order_reviews\?/);
    const patch = JSON.parse(options.body);
    if (patch.salla_publish_state === 'sending') assert.match(path, /status=eq.published/);
    Object.assign(row, patch);
    return Response.json([row]);
  };
  let remote;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname, target = new URL(url);
    assert.equal(target.origin, 'https://api.salla.dev');
    assert.equal(options.headers.authorization,'Bearer fixture-token');
    calls.push([options.method,path]);
    if (path.endsWith('/orders/77')) return Response.json({data:{id:77,customer:{id:33},items:[{name:'اشتراك تجريبي',product:{id:99}}]}});
    if (path.endsWith('/feedbacks') && options.method === 'GET') {
      assert.equal(target.searchParams.get('products'),'99');
      assert.equal(target.searchParams.get('customers'),'33');
      return Response.json({data:[]});
    }
    if (path.endsWith('/feedbacks') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['content','customer_id','order_id','product_id','rating','type']);
      assert.equal(body.type,'rating');
      assert.equal(body.rating,4);
      assert.equal(body.order_id,77);
      assert.equal(body.customer_id,33);
      assert.equal(body.product_id,99);
      assert.equal([...body.content].length,255);
      if (behavior === 'forbidden') return Response.json({}, {status:403});
      if (behavior === 'ambiguous') throw new TypeError('fixture disconnected');
      remote = {...body,id:55,is_published:false};
      return Response.json({data:remote});
    }
    if (path.endsWith('/feedbacks/55') && options.method === 'PUT') {
      assert.deepEqual(JSON.parse(options.body),{is_published:true});
      assert.equal(row.salla_feedback_id,'55');
      return Response.json({data:{...remote,is_published:true}});
    }
    assert.fail('Unexpected call: ' + path);
  });
  return {row,db,calls};
}

test('approval creates an order-linked Salla review and records publication without duplicating it', async t => {
  const {row,db,calls} = await fixture(t);
  const result=await publishApprovedReview(db,{...row});
  assert.equal(result.state,'published');
  assert.equal(result.id,55);
  assert.equal(row.salla_publish_state,'published');
  assert.match(result.message,/255/);
  assert.equal((await publishApprovedReview(db,{...row})).state,'published');
  assert.equal(calls.filter(([verb])=>verb==='POST').length,1);
});

test('a Salla permission failure keeps the local approval and reports the missing permission', async t => {
  const {row,db} = await fixture(t,'forbidden');
  const result=await publishApprovedReview(db,{...row});
  assert.equal(result.state,'failed');
  assert.match(result.message,/reviews.read_write/);
  assert.equal(row.status,'published');
  assert.equal(row.salla_feedback_id,null);
});

test('an ambiguous Salla response never triggers an automatic duplicate post', async t => {
  const {row,db,calls} = await fixture(t,'ambiguous');
  assert.equal((await publishApprovedReview(db,{...row})).state,'check_required');
  assert.equal((await publishApprovedReview(db,{...row})).state,'check_required');
  assert.equal(calls.filter(([verb])=>verb==='POST').length,1);
});

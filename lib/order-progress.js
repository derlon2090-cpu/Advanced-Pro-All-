export function setOrderProgress(stage) {
  const root = document.documentElement;
  if (root.dataset.orderProgress === stage) return;
  if (stage) root.dataset.orderProgress = stage;
  else delete root.dataset.orderProgress;
}

export function confirmOrderFound() {
  setOrderProgress('found');
  return new Promise(resolve => {
    const button = document.getElementById('continueToDevice');
    const proceed = () => {
      clearTimeout(timer);
      button.removeEventListener('click', proceed);
      resolve();
    };
    const timer = setTimeout(proceed, 1400);
    button.addEventListener('click', proceed);
  });
}

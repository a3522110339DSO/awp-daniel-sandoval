const DEFAULT_VAPID_PUBLIC_KEY =
  'BOr3FRCGDpa2BkLomqKgkl0vvArkH5-YW0HQwZ0pQfM9vDOMkMt2rt7NmBGG99nmCaTKtyfO0O5RAwOB1p5MNDo';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? DEFAULT_VAPID_PUBLIC_KEY;

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const isPushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window;

export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    throw new Error('El navegador no soporta notificaciones.');
  }

  if (Notification.permission !== 'default') {
    return Notification.permission;
  }

  return Notification.requestPermission();
};

export const subscribeUserToPush = async () => {
  if (!isPushSupported()) {
    throw new Error('El navegador no soporta notificaciones push.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existingSubscription = await registration.pushManager.getSubscription();
  if (existingSubscription) {
    return existingSubscription;
  }

  const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
};

export const getCurrentSubscription = async () => {
  if (!isPushSupported()) {
    return null;
  }
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
};

export const unsubscribeFromPush = async () => {
  const subscription = await getCurrentSubscription();
  if (subscription) {
    await subscription.unsubscribe();
    return true;
  }
  return false;
};

export const triggerLocalTestNotification = async () => {
  if (!isPushSupported()) {
    throw new Error('El navegador no soporta notificaciones push.');
  }
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: 'SHOW_TEST_NOTIFICATION' });
};

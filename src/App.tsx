import type { ChangeEvent, FC, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import { addTask, getAllTasks, type OfflineTask } from './services/db';
import {
  getCurrentSubscription,
  isPushSupported,
  requestNotificationPermission,
  subscribeUserToPush,
  triggerLocalTestNotification,
  unsubscribeFromPush,
} from './services/push';

// Declare SyncManager type globally.
declare global {
  interface SyncManager {
    register(tag: string): Promise<void>;
  }
}

const initialForm = {
  title: '',
  description: '',
};

const App: FC = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [tasks, setTasks] = useState<OfflineTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState(initialForm);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<'home' | 'registros'>('home');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );
  const [subscriptionJson, setSubscriptionJson] = useState('');
  const [pushError, setPushError] = useState('');
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const storedTasks = await getAllTasks();
        setTasks(storedTasks);
      } catch (err) {
        console.error('Error loading tasks from IndexedDB', err);
        setError('No se pudieron cargar las tareas guardadas.');
      } finally {
        setIsLoading(false);
      }
    };

    void loadTasks();
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === 'SYNC_COMPLETED' && Array.isArray(data.payload?.ids)) {
        const syncedIds: number[] = data.payload.ids;
        setTasks((prev) => prev.filter((task) => !syncedIds.includes(task.id)));
      }

      if (data.type === 'SYNC_ERROR' && typeof data.payload?.message === 'string') {
        setError('No se pudo sincronizar con el servidor. Se volverá a intentar automáticamente.');
        console.error('Background sync failed:', data.payload.message);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, []);

  useEffect(() => {
    if (!isPushSupported()) {
      return;
    }

    const fetchSubscription = async () => {
      const subscription = await getCurrentSubscription();
      if (subscription) {
        setSubscriptionJson(JSON.stringify(subscription.toJSON(), null, 2));
      } else {
        setSubscriptionJson('');
      }
    };

    void fetchSubscription();
  }, []);

  const queueBackgroundSync = useCallback(async () => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      if ('sync' in registration && 'SyncManager' in window) {
        await (registration.sync as SyncManager).register('sync-entries');
      } else {
        registration.active?.postMessage({ type: 'MANUAL_SYNC' });
      }
    } catch (err) {
      console.error('Error registering background sync', err);
      try {
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({ type: 'MANUAL_SYNC' });
      } catch (fallbackError) {
        console.error('Fallback manual sync failed', fallbackError);
      }
    }
  }, []);

  const requestImmediateSync = useCallback(async () => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: 'MANUAL_SYNC' });
    } catch (err) {
      console.error('Error requesting immediate sync', err);
    }
  }, []);

  useEffect(() => {
    // Subscribe to network status changes to toggle offline banner.
    const handleOnline = () => {
      setIsOffline(false);
      void requestImmediateSync();
    };

    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [requestImmediateSync]);

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const trimmedTitle = formData.title.trim();
    const trimmedDescription = formData.description.trim();

    if (!trimmedTitle && !trimmedDescription) {
      setError('Agrega al menos un título o una descripción.');
      return;
    }

    const newTask: OfflineTask = {
      id: Date.now(),
      title: trimmedTitle,
      description: trimmedDescription,
      createdAt: new Date().toISOString(),
      syncStatus: 'pending',
    };

    try {
      await addTask(newTask);
      setTasks((prev) => [newTask, ...prev]);
      setFormData(initialForm);

      if (isOffline) {
        void queueBackgroundSync();
      } else {
        void requestImmediateSync();
      }
    } catch (err) {
      console.error('Error saving task to IndexedDB', err);
      setError('No se pudo guardar la tarea localmente.');
    }
  };

  const handleEnableNotifications = async () => {
    if (!isPushSupported()) {
      setPushError('Este navegador no soporta notificaciones push.');
      return;
    }

    setPushError('');
    setIsSubscribing(true);
    try {
      const permission = await requestNotificationPermission();
      setNotificationPermission(permission);

      if (permission !== 'granted') {
        setPushError('Necesitas conceder permisos para activar las notificaciones.');
        return;
      }

      const subscription = await subscribeUserToPush();
      setSubscriptionJson(JSON.stringify(subscription.toJSON(), null, 2));
    } catch (err) {
      console.error('No se pudo activar las notificaciones push', err);
      setPushError('No se pudo activar las notificaciones push. Intenta más tarde.');
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleDisableNotifications = async () => {
    setPushError('');
    try {
      const result = await unsubscribeFromPush();
      if (result) {
        setSubscriptionJson('');
      }
    } catch (err) {
      console.error('No se pudo desactivar las notificaciones push', err);
      setPushError('No se pudo desactivar la suscripción.');
    }
  };

  const handleTestNotification = async () => {
    setPushError('');
    try {
      await triggerLocalTestNotification();
    } catch (err) {
      console.error('No se pudo mostrar la notificación de prueba', err);
      setPushError('No se pudo mostrar la notificación de prueba.');
    }
  };

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [tasks],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Panel  AWP</h1>
        <p>Gestiona tus registros incluso sin conexión.</p>
        <nav className="app-nav" aria-label="Secciones principales">
          <button
            type="button"
            className={`app-nav__button${activeView === 'home' ? ' app-nav__button--active' : ''}`}
            onClick={() => setActiveView('home')}
          >
            Inicio
          </button>
          <button
            type="button"
            className={`app-nav__button${activeView === 'registros' ? ' app-nav__button--active' : ''}`}
            onClick={() => setActiveView('registros')}
          >
            Registros 
          </button>
        </nav>
      </header>

      <main className="app-main">
        {activeView === 'home' ? (
          <>
            <section className="card hero-card">
              <h2>¡Bienvenido a mi PWA!</h2>
              <p>
                Esta aplicación está lista para funcionar offline, enviar notificaciones y sincronizar datos
                en segundo plano.
              </p>
            </section>
            <section className="card features-card">
              <h3>Características clave</h3>
              <ul className="features-list">
                <li>✅ Experiencia instalable tipo app</li>
                <li>✅ Persistencia local con IndexedDB</li>
                <li>✅ Preparada para notificaciones push</li>
                <li>✅ Base para sincronización en segundo plano</li>
              </ul>
            </section>
            <section className="card">
              <h3>Notificaciones push</h3>
              <p>
                Suscríbete para recibir avisos sobre nuevas actividades. El token generado se muestra abajo,
                úsalo en tu backend o herramienta de pruebas.
              </p>
              <div className="push-actions">
                <button
                  type="button"
                  className="push-actions__button"
                  onClick={handleEnableNotifications}
                  disabled={isSubscribing || notificationPermission === 'granted'}
                >
                  {isSubscribing ? 'Activando…' : 'Activar notificaciones'}
                </button>
                <button
                  type="button"
                  className="push-actions__button push-actions__button--ghost"
                  onClick={handleDisableNotifications}
                  disabled={!subscriptionJson}
                >
                  Desactivar
                </button>
                <button
                  type="button"
                  className="push-actions__button push-actions__button--secondary"
                  onClick={handleTestNotification}
                  disabled={notificationPermission !== 'granted'}
                >
                  Probar notificación local
                </button>
              </div>
              <p className="hint">
                Estado actual: {notificationPermission === 'granted' ? 'Permiso concedido' : notificationPermission === 'denied' ? 'Bloqueado' : 'Pendiente'}
              </p>
              {pushError && <p className="form-error">{pushError}</p>}
              {subscriptionJson ? (
                <div className="subscription-box">
                  <p className="subscription-box__title">Datos de suscripción:</p>
                  <pre>{subscriptionJson}</pre>
                </div>
              ) : (
                <p className="hint">Aún no hay suscripción generada.</p>
              )}
            </section>
          </>
        ) : (
          <>
            <section
              className={`status-banner ${isOffline ? 'status-banner--offline' : 'status-banner--online'}`}
              role="status"
              aria-live="polite"
            >
              {isOffline ? (
                <span>Modo offline activo: los cambios se guardan en este dispositivo.</span>
              ) : (
                <span>Conexión establecida. Tus datos locales están disponibles.</span>
              )}
            </section>

            <section className="card">
              <h2>Nuevo registro</h2>
              <p>Captura actividades o tareas; si pierdes conexión se guardarán localmente.</p>
              <form className="task-form" onSubmit={handleSubmit}>
                <label className="task-form__field">
                  <span>Título</span>
                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleChange}
                    placeholder="Ej. Reporte de matemáticas"
                    autoComplete="off"
                  />
                </label>
                <label className="task-form__field">
                  <span>Descripción</span>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    placeholder="Detalles de la actividad"
                    rows={4}
                  />
                </label>
                {error && <p className="form-error">{error}</p>}
                <button type="submit" className="task-form__submit">
                  Guardar localmente
                </button>
              </form>
            </section>

            <section className="card">
              <h2>Registros guardados</h2>
              {isLoading ? (
                <p className="hint">Cargando tus registros guardados…</p>
              ) : sortedTasks.length === 0 ? (
                <p className="hint">Aún no hay registros. Crea uno para verlo aquí.</p>
              ) : (
                <ul className="tasks-list">
                  {sortedTasks.map((task) => (
                    <li key={task.id} className="tasks-list__item">
                      <header>
                        <h3>{task.title || 'Sin título'}</h3>
                        <time dateTime={task.createdAt}>
                          {new Date(task.createdAt).toLocaleString()}
                        </time>
                      </header>
                      {task.syncStatus === 'pending' ? (
                        <span className="badge badge--pending">Pendiente de sincronizar</span>
                      ) : (
                        <span className="badge">Sincronizado</span>
                      )}
                      {task.description && <p>{task.description}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>© 2025 Panel Offline AWP. Tus datos permanecen contigo.</p>
      </footer>
    </div>
  );
};

export default App;

import type { FC } from 'react';
import './App.css';

const App: FC = () => {
  return (
    <div className="app">
      <header className="app-header">
        <h1>My Progressive Web App</h1>
      </header>
      
      <main className="app-main">
        <div className="welcome-card">
          <h2>¡Bienvenido a tu PWA!</h2>
          <p>Esta es una aplicación web progresiva construida con:</p>
          <ul>
            <li>React</li>
            <li>Vite</li>
            <li>TypeScript</li>
          </ul>
        </div>

        <div className="features-card">
          <h3>Características PWA:</h3>
          <ul>
            <li>✅ Instalable</li>
            <li>✅ Funciona Offline</li>
            <li>✅ Responsive</li>
            <li>✅ Rápida</li>
          </ul>
        </div>
      </main>

      <footer className="app-footer">
        <p>© 2025 My PWA. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
};

export default App;

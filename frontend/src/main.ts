import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServiceWorker } from '@angular/service-worker';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  ...appConfig,
  providers: [...appConfig.providers, provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() })],
}).catch((error: unknown) => console.error(error));

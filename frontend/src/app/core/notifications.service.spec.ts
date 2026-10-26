import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SwPush } from '@angular/service-worker';
import { of } from 'rxjs';
import { AuthSessionService } from './auth-session.service';
import { NotificationsClientService, type Aviso } from './notifications.service';

describe('NotificationsClientService', () => {
  const session = { isAuthenticated: signal(false), logout: jasmine.createSpy('logout') };
  const swPush = {
    isEnabled: true,
    subscription: of({ endpoint: 'https://fcm.googleapis.com/x' }),
    unsubscribe: jasmine.createSpy('unsubscribe').and.resolveTo(undefined),
  };

  beforeEach(() => {
    session.logout.calls.reset();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthSessionService, useValue: session },
        { provide: SwPush, useValue: swPush },
      ],
    });
  });

  it('al marcar un aviso como leído baja el contador y lo informa al servidor', () => {
    const servicio = TestBed.inject(NotificationsClientService);
    const http = TestBed.inject(HttpTestingController);
    const aviso: Aviso = {
      id: 'n1',
      type: 'X',
      title: 'T',
      body: 'B',
      link: '/coordinacion',
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    servicio.items.set([aviso]);
    servicio.unread.set(2);
    servicio.marcarLeido(aviso).subscribe();
    expect(servicio.unread()).toBe(1);
    expect(servicio.items()[0].readAt).not.toBeNull();
    http.expectOne({ method: 'POST', url: '/api/notifications/n1/read' }).flush({ updated: 1 });
    http.verify();
  });

  it('cierra la sesión aunque falle la desvinculación del dispositivo', async () => {
    const servicio = TestBed.inject(NotificationsClientService);
    const http = TestBed.inject(HttpTestingController);
    const salida = servicio.cerrarSesion();
    await Promise.resolve();
    http
      .expectOne({ method: 'DELETE', url: '/api/notifications/push/subscriptions' })
      .flush('caído', { status: 500, statusText: 'Error' });
    await salida;
    expect(session.logout).toHaveBeenCalled();
  });
});

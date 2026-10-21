import express from 'express';
import { once } from 'node:events';
import { configureTrustedProxy } from './trust-proxy';

describe('configureTrustedProxy (AUD-004)', () => {
  it('usa la IP del cliente después de dos proxies confiables e ignora cabeceras previas', async () => {
    const app = express();
    configureTrustedProxy(app, 2);
    app.get('/ip', (request, response) => response.json({ ip: request.ip }));
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Servidor de prueba sin puerto.');
      const response = await fetch(`http://127.0.0.1:${address.port}/ip`, {
        headers: { 'X-Forwarded-For': '198.51.100.99, 203.0.113.10, 192.0.2.20' },
      });
      expect(await response.json()).toEqual({ ip: '203.0.113.10' });
    } finally {
      server.close();
    }
  });

  it('rechaza valores de saltos no permitidos', () => {
    expect(() => configureTrustedProxy(express(), -1)).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => configureTrustedProxy(express(), 3)).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => configureTrustedProxy(express(), 1.5)).toThrow(/TRUST_PROXY_HOPS/);
  });
});

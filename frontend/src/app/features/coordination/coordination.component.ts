import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthSessionService } from '../../core/auth-session.service';
import { fechaCalendario, fechaHora } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';
import { SEDES, nombreSede } from '../../core/sedes';
import { ExpirationsPanelComponent } from './expirations-panel.component';
import { ReportsPanelComponent } from '../reports/reports-panel.component';

import {
  agruparRespuestasDetalle,
  calcularDuracionDesde,
  type Certificado,
  type Colaborador,
  type Dashboard,
  type Detail,
  type DocumentoCustodia,
  type FilaArl,
  type FilaCumplimiento,
  type Grupo,
  type Integrante,
  type JornadaAbierta,
  type PaginaCustodia,
  type Planilla,
  type Respuesta,
  type Submission,
} from './coordination.models';

/**
 * Puesto de trabajo de la coordinadora. La especificaci?n le asigna dos
 * responsabilidad: revisar y autorizar el inicio de labores.
 */
@Component({
  imports: [ReactiveFormsModule, RouterLink, LogoutButtonComponent, ExpirationsPanelComponent, ReportsPanelComponent],
  templateUrl: './coordination.component.html',
  styleUrl: './coordination.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoordinationComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);

  readonly pestana = signal<
    'bandeja' | 'jornadas' | 'vencimientos' | 'cumplimiento' | 'colaboradores' | 'custodia' | 'reportes'
  >('bandeja');
  /** Requisitos vencidos o que vencen en 15 días; se muestra en la pestaña. */
  readonly vencimientosProximos = signal(0);
  readonly dashboard = signal<Dashboard | null>(null);
  readonly pending = signal<Submission[]>([]);
  readonly detail = signal<Detail | null>(null);
  readonly firmaUrl = signal<string | null>(null);
  /** Firmas de la cuadrilla como URL de objeto, por id de integrante. */
  readonly firmasCuadrilla = signal<Record<string, string>>({});
  readonly motivo = signal('');
  readonly decidiendo = signal(false);
  readonly ultimoPdf = signal<string | null>(null);
  readonly colaboradores = signal<Colaborador[]>([]);
  readonly guardando = signal(false);
  readonly error = signal('');

  // ── Jornadas y requisitos ──
  readonly jornadas = signal<JornadaAbierta[]>([]);
  readonly cierreId = signal<string | null>(null);
  readonly motivoCierre = signal('');
  readonly cerrando = signal(false);
  readonly generandoPdf = signal(false);
  readonly cumplimiento = signal<FilaCumplimiento[]>([]);
  readonly planillas = signal<Planilla[]>([]);
  readonly certificados = signal<Certificado[]>([]);
  readonly cubiertos = signal<string[]>([]);
  readonly documentosCustodia = signal<DocumentoCustodia[]>([]);
  readonly paginaCustodia = signal(1);
  readonly totalPaginasCustodia = signal(0);
  readonly totalDocumentosCustodia = signal(0);
  readonly tamanoPaginaCustodia = 50;

  readonly formPlanilla = this.fb.nonNullable.group({
    reference: ['', [Validators.required, Validators.maxLength(100)]],
    providerName: [''],
    periodStart: ['', Validators.required],
    periodEnd: ['', Validators.required],
  });

  readonly formCertificado = this.fb.nonNullable.group({
    collaboratorId: ['', Validators.required],
    issuedAt: ['', Validators.required],
    expiresAt: ['', Validators.required],
    trainingEntity: [''],
  });
  readonly formCustodia = this.fb.nonNullable.group({ month: [''], date: [''], site: [''] });
  readonly sedes = SEDES;
  readonly nombreSede = nombreSede;
  readonly aviso = signal('');

  /** Estado de ARL por colaborador, para mostrarlo junto a cada perfil. */
  private readonly arlPorColaborador = signal<Record<string, FilaArl['arlStatus']>>({});

  readonly valoresIniciales = {
    documentType: 'CC',
    documentNumber: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    team: '',
    email: '',
    phone: '',
    pin: '',
  };

  readonly formulario = this.fb.nonNullable.group({
    documentType: ['CC', Validators.required],
    documentNumber: ['', [Validators.required, Validators.pattern(/^[0-9A-Za-z-]{5,30}$/)]],
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    jobTitle: ['', Validators.required],
    team: ['', Validators.maxLength(100)],
    email: ['', Validators.email],
    phone: ['', Validators.maxLength(30)],
    pin: [''],
  });

  /**
   * Traduce las respuestas crudas a las etiquetas del formulario publicado y
   * las agrupa por sección. Un "NO" dentro de la lista de verificación es
   * justo lo que debe saltar a la vista antes de autorizar un trabajo en
   * altura, así que se marca como alerta.
   */
  readonly grupos = computed<Grupo[]>(() => agruparRespuestasDetalle(this.detail()));

  readonly incumplimientos = computed<Respuesta[]>(() =>
    this.grupos().flatMap((grupo) => grupo.respuestas.filter((respuesta) => respuesta.alerta)),
  );

  /** Solo los cargos que exigen certificado de alturas (hoy, el Oficial eléctrico). */
  readonly oficialesElectricos = computed(() =>
    this.cumplimiento().filter((fila) => fila.cumplimiento.alturas.estado !== 'NO_APLICA'),
  );
  readonly pdfsCustodia = computed(() =>
    this.documentosCustodia().filter((documento) => documento.finalPdfFile !== null),
  );
  readonly primerRegistroCustodia = computed(() =>
    this.totalDocumentosCustodia() ? (this.paginaCustodia() - 1) * this.tamanoPaginaCustodia + 1 : 0,
  );
  readonly ultimoRegistroCustodia = computed(() =>
    Math.min(this.paginaCustodia() * this.tamanoPaginaCustodia, this.totalDocumentosCustodia()),
  );

  constructor() {
    this.cargar();
    this.contarVencimientos();
    // Los avisos enlazan a una pestaña concreta (?pestana=jornadas).
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((parametros) => this.abrirPestana(parametros.get('pestana')));
  }

  private abrirPestana(nombre: string | null): void {
    if (nombre === 'jornadas') this.verJornadas();
    else if (nombre === 'cumplimiento') this.verCumplimiento();
    else if (nombre === 'custodia') this.verCustodia();
    else if (nombre === 'vencimientos' || nombre === 'reportes') this.pestana.set(nombre);
  }

  contarVencimientos(): void {
    this.http
      .get<{ vencidos: number; porVencer: number }>('/api/compliance/expirations', { params: { days: 15 } })
      .subscribe({
        next: (respuesta) => this.vencimientosProximos.set(respuesta.vencidos + respuesta.porVencer),
        error: () => undefined,
      });
  }

  // ── Bandeja ──────────────────────────────────────────────
  cargar(): void {
    this.error.set('');
    this.http.get<Dashboard>('/api/coordination/dashboard').subscribe({
      next: (dashboard) => this.dashboard.set(dashboard),
      error: () => this.error.set('No tienes permiso para consultar coordinación.'),
    });
    this.http.get<Submission[]>('/api/coordination/submissions/pending').subscribe({
      next: (pending) => this.pending.set(pending),
      error: () => undefined,
    });
  }

  // ── Jornadas abiertas ────────────────────────────────────
  verJornadas(): void {
    this.pestana.set('jornadas');
    this.cargarJornadas();
  }

  cargarJornadas(): void {
    this.http.get<JornadaAbierta[]>('/api/coordination/open-workdays').subscribe({
      next: (lista) => this.jornadas.set(lista),
      error: () => this.error.set('No fue posible consultar las jornadas abiertas.'),
    });
  }

  cerrarAdministrativamente(id: string): void {
    const reason = this.motivoCierre().trim();
    if (!reason || this.cerrando()) return;
    this.cerrando.set(true);
    this.error.set('');
    this.http.post(`/api/coordination/submissions/${id}/admin-close`, { reason }).subscribe({
      next: () => {
        this.cerrando.set(false);
        this.cierreId.set(null);
        this.motivoCierre.set('');
        this.aviso.set('Jornada cerrada administrativamente.');
        this.cargarJornadas();
        this.cargar();
      },
      error: () => {
        this.cerrando.set(false);
        this.error.set('No fue posible cerrar la jornada administrativamente.');
      },
    });
  }

  // ── Custodia documental ──────────────────────────────────
  verCustodia(): void {
    this.pestana.set('custodia');
    this.cargarCustodia();
  }

  cargarCustodia(page = 1): void {
    const { month, date, site } = this.formCustodia.getRawValue();
    const parametros = new URLSearchParams();
    if (date) parametros.set('date', date);
    else if (month) parametros.set('month', month);
    if (site) parametros.set('site', site);
    parametros.set('page', String(page));
    parametros.set('pageSize', String(this.tamanoPaginaCustodia));
    this.http.get<PaginaCustodia>(`/api/coordination/submissions?${parametros.toString()}`).subscribe({
      next: (resultado) => {
        this.documentosCustodia.set(resultado.items);
        this.paginaCustodia.set(resultado.page);
        this.totalPaginasCustodia.set(resultado.totalPages);
        this.totalDocumentosCustodia.set(resultado.total);
      },
      error: () => this.error.set('No fue posible consultar el archivo documental.'),
    });
  }

  generarPdf(id: string): void {
    if (this.generandoPdf()) return;
    this.generandoPdf.set(true);
    this.error.set('');
    this.http.post(`/api/coordination/submissions/${id}/generate-pdf`, {}).subscribe({
      next: () => {
        this.generandoPdf.set(false);
        this.aviso.set('PDF generado y registrado.');
        this.cargarCustodia(this.paginaCustodia());
      },
      error: () => {
        this.generandoPdf.set(false);
        this.error.set('No fue posible generar el PDF pendiente. Revisa las firmas del permiso.');
      },
    });
  }

  limpiarCustodia(): void {
    this.formCustodia.reset({ month: '', date: '', site: '' });
    this.cargarCustodia();
  }

  descargarCustodia(): void {
    for (const documento of this.pdfsCustodia()) {
      if (documento.finalPdfFile) this.descargar(documento.finalPdfFile.id, documento.finalPdfFile.originalName);
    }
  }

  // ── Requisitos ───────────────────────────────────────────
  verCumplimiento(): void {
    this.pestana.set('cumplimiento');
    if (!this.cumplimiento().length) this.cargarCumplimiento();
    if (!this.planillas().length) this.cargarPlanillas();
    if (!this.certificados().length) this.cargarCertificados();
  }

  cargarCumplimiento(): void {
    this.http.get<{ rows: FilaCumplimiento[] }>('/api/compliance/overview').subscribe({
      next: (respuesta) => this.cumplimiento.set(respuesta.rows),
      error: () => this.error.set('No fue posible consultar el cumplimiento.'),
    });
  }

  cargarPlanillas(): void {
    this.http.get<Planilla[]>('/api/compliance/payrolls').subscribe({
      next: (lista) => this.planillas.set(lista),
      error: () => undefined,
    });
  }

  cargarCertificados(): void {
    this.http.get<Certificado[]>('/api/compliance/height-certificates').subscribe({
      next: (lista) => this.certificados.set(lista),
      error: () => undefined,
    });
  }

  estaCubierto(collaboratorId: string): boolean {
    return this.cubiertos().includes(collaboratorId);
  }

  alternarCubierto(collaboratorId: string): void {
    this.cubiertos.update((lista) =>
      lista.includes(collaboratorId) ? lista.filter((otro) => otro !== collaboratorId) : [...lista, collaboratorId],
    );
  }

  crearPlanilla(): void {
    if (this.formPlanilla.invalid || !this.cubiertos().length) return;
    this.guardando.set(true);
    this.error.set('');
    const valores = this.formPlanilla.getRawValue();
    this.http
      .post('/api/compliance/payrolls', {
        reference: valores.reference,
        providerName: valores.providerName || undefined,
        periodStart: valores.periodStart,
        periodEnd: valores.periodEnd,
        collaboratorIds: this.cubiertos(),
      })
      .subscribe({
        next: () => {
          this.aviso.set('Planilla registrada. Sus integrantes quedaron al día.');
          this.formPlanilla.reset({ reference: '', providerName: '', periodStart: '', periodEnd: '' });
          this.cubiertos.set([]);
          this.guardando.set(false);
          this.cargarPlanillas();
          this.cargarCumplimiento();
        },
        error: () => {
          this.error.set('No fue posible registrar la planilla. Revisa las fechas e intenta de nuevo.');
          this.guardando.set(false);
        },
      });
  }

  crearCertificado(): void {
    if (this.formCertificado.invalid) return;
    this.guardando.set(true);
    this.error.set('');
    const valores = this.formCertificado.getRawValue();
    this.http
      .post('/api/compliance/height-certificates', {
        collaboratorId: valores.collaboratorId,
        issuedAt: valores.issuedAt,
        expiresAt: valores.expiresAt,
        trainingEntity: valores.trainingEntity || undefined,
      })
      .subscribe({
        next: () => {
          this.aviso.set('Certificado registrado.');
          this.formCertificado.reset({ collaboratorId: '', issuedAt: '', expiresAt: '', trainingEntity: '' });
          this.guardando.set(false);
          this.cargarCertificados();
          this.cargarCumplimiento();
        },
        error: () => {
          this.error.set('No fue posible registrar el certificado. Revisa las fechas e intenta de nuevo.');
          this.guardando.set(false);
        },
      });
  }

  subirSoportePlanilla(payrollId: string, evento: Event): void {
    this.subirSoporte(`/api/compliance/payrolls/${payrollId}/file`, evento, () => this.cargarPlanillas());
  }

  subirSoporteCertificado(certificateId: string, evento: Event): void {
    this.subirSoporte(`/api/compliance/height-certificates/${certificateId}/file`, evento, () =>
      this.cargarCertificados(),
    );
  }

  /** Sin Content-Type explícito: el navegador debe poner su propio separador. */
  private subirSoporte(url: string, evento: Event, alTerminar: () => void): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    const cuerpo = new FormData();
    cuerpo.append('file', archivo);
    this.http.post(url, cuerpo).subscribe({
      next: () => {
        this.aviso.set('Soporte cargado.');
        alTerminar();
      },
      error: () => this.error.set('No fue posible cargar el soporte. Debe ser PDF, JPG o PNG de máximo 10 MB.'),
    });
  }

  claseRequisito(estado: string): string {
    if (estado === 'VIGENTE') return 'vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'por-vencer';
    if (estado === 'NO_APLICA') return 'neutro';
    return 'vencida';
  }

  textoRequisito(estado: string): string {
    if (estado === 'VIGENTE') return 'Vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'Por vencer';
    if (estado === 'NO_APLICA') return 'No aplica';
    return 'Vencida';
  }

  hora(valor: string | null): string {
    if (!valor) return '—';
    return new Date(valor).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  duracionDesde(inicio: string | null): string {
    return calcularDuracionDesde(inicio);
  }

  integrantesTexto(integrantes: { collaborator: { firstName: string; lastName: string } }[]): string {
    return integrantes.map((item) => `${item.collaborator.firstName} ${item.collaborator.lastName}`).join(', ');
  }

  intervaloJornada(inicio: string | null, fin: string | null): string {
    if (!inicio) return 'Sin hora de inicio';
    return fin ? `${this.hora(inicio)} a ${this.hora(fin)}` : `${this.hora(inicio)} · en curso`;
  }

  claseEstadoDocumento(estado: string): string {
    if (estado === 'CLOSED') return 'vigente';
    if (estado === 'REJECTED' || estado === 'EXPIRED') return 'vencida';
    return 'por-vencer';
  }

  textoEstadoDocumento(estado: string): string {
    if (estado === 'CLOSED') return 'Cerrado';
    if (estado === 'APPROVED') return 'En curso';
    if (estado === 'PENDING_APPROVAL') return 'Pendiente';
    if (estado === 'EXPIRED') return 'Vencido sin iniciar';
    if (estado === 'REJECTED') return 'Rechazado';
    return estado;
  }

  abrir(id: string): void {
    this.motivo.set('');
    this.firmaUrl.set(null);
    this.http.get<Detail>(`/api/coordination/submissions/${id}`).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.cargarFirmasCuadrilla(detail.members ?? []);
      },
      error: () => this.error.set('No fue posible abrir el envío.'),
    });
  }

  cerrarRevision(): void {
    this.liberarFirmas();
    this.detail.set(null);
    this.motivo.set('');
  }

  decidir(id: string, decision: 'APPROVED' | 'REJECTED'): void {
    const texto = this.motivo().trim();
    if (decision === 'REJECTED' && !texto) return;
    this.decidiendo.set(true);
    this.error.set('');
    this.http
      .post<{ pdfFileId: string }>(
        `/api/coordination/submissions/${id}/decision`,
        decision === 'REJECTED' ? { decision, reason: texto } : { decision, observation: texto || undefined },
      )
      .subscribe({
        next: (result) => {
          this.ultimoPdf.set(result.pdfFileId);
          this.aviso.set(
            decision === 'APPROVED'
              ? result.pdfFileId
                ? 'Aprobado. El formato quedó archivado con su documento final.'
                : 'Autorizado. El colaborador ya puede iniciar labores; el PDF se genera al cerrar la jornada.'
              : 'Envío rechazado. El colaborador verá el motivo registrado.',
          );
          this.decidiendo.set(false);
          this.cerrarRevision();
          this.cargar();
        },
        error: (respuesta: { error?: { message?: unknown } }) => {
          // Por ejemplo, falta registrar la firma que se estampa al aprobar.
          const detalle = respuesta.error?.message;
          this.error.set(typeof detalle === 'string' ? detalle : 'No fue posible registrar la decisión.');
          this.decidiendo.set(false);
        },
      });
  }

  descargar(id: string, nombre = 'permiso-sg-sst.pdf'): void {
    this.http.get(`/api/files/${id}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = nombre;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set('No fue posible descargar el documento.'),
    });
  }

  // ── Colaboradores ────────────────────────────────────────
  verColaboradores(): void {
    this.pestana.set('colaboradores');
    if (!this.colaboradores().length) this.cargarColaboradores();
  }

  cargarColaboradores(): void {
    this.http.get<Colaborador[]>('/api/collaborators').subscribe({
      next: (lista) => this.colaboradores.set(lista),
      error: () => this.error.set('No fue posible cargar los colaboradores.'),
    });
    this.http.get<FilaArl[]>('/api/arl').subscribe({
      next: (filas) =>
        this.arlPorColaborador.set(
          Object.fromEntries(filas.map((fila) => [fila.collaborator.id, fila.arlStatus])) as Record<
            string,
            FilaArl['arlStatus']
          >,
        ),
      error: () => undefined,
    });
  }

  crear(): void {
    if (this.formulario.invalid) return;
    this.guardando.set(true);
    this.error.set('');
    this.aviso.set('');
    const valores = this.formulario.getRawValue();
    // El backend rechaza cadenas vacías en los campos opcionales.
    const cuerpo = Object.fromEntries(
      Object.entries(valores).filter(([, valor]) => typeof valor === 'string' && valor.trim() !== ''),
    );
    this.http.post<Colaborador>('/api/collaborators', cuerpo).subscribe({
      next: (creado) => {
        this.aviso.set(`${creado.firstName} ${creado.lastName} quedó registrado. Ya puede ingresar con su PIN.`);
        this.formulario.reset(this.valoresIniciales);
        this.guardando.set(false);
        this.cargarColaboradores();
      },
      error: (respuesta: { status: number }) => {
        this.error.set(
          respuesta.status === 409
            ? 'Ya existe un colaborador con ese número de documento.'
            : 'No fue posible registrar al colaborador. Revisa los datos e intenta de nuevo.',
        );
        this.guardando.set(false);
      },
    });
  }

  arlDe(collaboratorId: string): string {
    return this.arlPorColaborador()[collaboratorId] ?? 'VENCIDA';
  }

  // ── Presentación ─────────────────────────────────────────
  fecha(valor: string | null): string {
    return fechaHora(valor);
  }

  soloFecha(valor: string | null): string {
    return fechaCalendario(valor);
  }

  claseArl(estado: string | undefined): string {
    if (estado === 'VIGENTE') return 'vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'por-vencer';
    return 'vencida';
  }

  textoArl(estado: string | undefined): string {
    if (estado === 'VIGENTE') return 'Vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'Próxima a vencer';
    return 'Vencida';
  }

  /** Descarga la firma de cada integrante para mostrarlas en la revisión. */
  private cargarFirmasCuadrilla(integrantes: Integrante[]): void {
    this.liberarFirmas();
    for (const integrante of integrantes) {
      const fileId = integrante.signature?.file.id;
      if (!fileId) continue;
      this.http.get(`/api/files/${fileId}/download`, { responseType: 'blob' }).subscribe({
        next: (blob) =>
          this.firmasCuadrilla.update((mapa) => ({ ...mapa, [integrante.id]: URL.createObjectURL(blob) })),
        error: () => undefined,
      });
    }
  }

  private liberarFirmas(): void {
    for (const url of Object.values(this.firmasCuadrilla())) URL.revokeObjectURL(url);
    this.firmasCuadrilla.set({});
  }

  private liberarFirma(): void {
    const url = this.firmaUrl();
    if (url) URL.revokeObjectURL(url);
    this.firmaUrl.set(null);
  }
}

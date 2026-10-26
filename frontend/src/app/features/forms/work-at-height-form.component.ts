import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';
import { fechaCalendario } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';

import {
  BORRADOR,
  CHARLAS_DE_SEGURIDAD,
  agruparCamposEnBloques,
  esCampoDeApertura,
  esObligatorio,
  calcularPorcentajeAvance,
  normalizarRespuestasFormulario,
  obtenerExplicacionAuto,
  obtenerValorAutomatico,
  type Bloque,
  type Campo,
  type Candidato,
  type Cargo,
  type Correccion,
  type Definicion,
  type Envio,
  type Etapa,
  type Flujo,
  type Integrante,
} from './work-at-height-form.models';
import { formatoPorSlug } from './formatos';

/**
 * Flujo previo al inicio de labores, común a los formatos oficiales: el perfil
 * que entrega la API decide si hay charla, cuántas personas caben, si hay
 * jornada y qué firmas se piden.
 *
 * Se recorre de pie, en obra y desde un celular, as? que cada pantalla plantea
 * una sola tarea, el avance est? siempre a la vista y lo diligenciado se guarda
 * en el dispositivo por si la aplicaci?n se cierra a media jornada.
 */
@Component({
  imports: [ReactiveFormsModule, RouterLink, LogoutButtonComponent],
  templateUrl: './work-at-height-form.component.html',
  styleUrl: './work-at-height-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkAtHeightFormComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly ruta = inject(ActivatedRoute);
  @ViewChild('lienzo') lienzo?: ElementRef<HTMLCanvasElement>;
  @ViewChild('videoCharla') videoCharla?: ElementRef<HTMLVideoElement>;

  /** Formato de la ruta (/formulario/<slug>). */
  readonly formato = formatoPorSlug(this.ruta.snapshot.paramMap.get('formato'));
  private readonly codigo = this.formato?.codigo ?? '';
  readonly titulo = this.formato?.titulo ?? 'Formato';
  readonly etapa = signal<Etapa>('arl');
  readonly flujo = signal<Flujo | null>(null);
  readonly definicion = signal<Definicion | null>(null);
  readonly charlaActual = signal(CHARLAS_DE_SEGURIDAD[Math.floor(Math.random() * CHARLAS_DE_SEGURIDAD.length)]);
  readonly charlaTerminada = signal(false);
  readonly charlaConfirmada = signal(false);
  readonly charlaToken = signal<string | null>(null);
  readonly charlaPreparando = signal(false);
  private ultimoSegundoPermitido = 0;
  readonly indiceBloque = signal(0);
  readonly faltantes = signal<string[]>([]);
  readonly hayFirma = signal(false);
  readonly enviando = signal(false);
  readonly consultando = signal(false);
  readonly envio = signal<Envio>(null);
  readonly error = signal('');

  // ── Cuadrilla y firmas ──
  readonly candidatos = signal<Candidato[]>([]);
  readonly cargos = signal<Cargo[]>([]);
  readonly excluidos = signal(0);
  readonly integrantes = signal<Integrante[]>([]);
  readonly indiceFirma = signal(0);
  readonly yoId = signal<string | null>(null);

  // ── Cierre de jornada ──
  readonly novedades = signal('');
  /** Respuestas que el formato pide una vez terminada la tarea. */
  readonly respuestasCierre = new FormGroup<Record<string, FormControl<unknown>>>({});
  readonly faltantesCierre = signal<string[]>([]);
  /** Firmas de término ya capturadas, por colaborador. */
  readonly firmasCierre = signal<Record<string, string>>({});
  readonly indiceFirmaCierre = signal(0);
  readonly cerrando = signal(false);
  readonly iniciando = signal(false);

  // ── Corrección de un permiso rechazado ──
  /** Permiso rechazado que se está corrigiendo; viaja en el reenvío. */
  readonly correccion = signal<Correccion | null>(null);
  /** Último permiso rechazado que el oficial aún puede corregir. */
  readonly rechazoPendiente = signal<{ id: string; reason: string | null } | null>(null);
  /** Integrantes del permiso anterior que hoy ya no cumplen y quedaron fuera. */
  readonly omitidosCorreccion = signal(0);
  private correccionAplicada = false;

  /** A quién le toca firmar ahora. */
  readonly firmante = computed<Integrante | null>(() => this.integrantes()[this.indiceFirma()] ?? null);
  readonly firmadas = computed(() => this.integrantes().filter((persona) => persona.firmaDataUrl).length);
  readonly perfil = computed(() => this.flujo()?.perfil ?? null);
  /** Filas de integrantes que imprime el formato; la API aplica el mismo límite. */
  readonly maxIntegrantes = computed(() => this.perfil()?.maxIntegrantes ?? 1);
  readonly cuadrillaCompleta = computed(() => this.integrantes().length >= this.maxIntegrantes());
  readonly esUltimoFirmante = computed(() => this.indiceFirma() >= this.integrantes().length - 1);

  readonly respuestas = new FormGroup<Record<string, FormControl<unknown>>>({});

  private dibujando = false;
  private sondeo?: ReturnType<typeof setInterval>;

  /** Cada sección del esquema publicado es un paso del formulario. */
  readonly bloques = computed<Bloque[]>(() =>
    agruparCamposEnBloques(this.definicion()?.schemaJson.fields.filter(esCampoDeApertura)),
  );

  /** Lo que se diligencia al cerrar (p. ej. la entrega de la tarea del ATS). */
  readonly camposCierre = computed<Campo[]>(() =>
    (this.definicion()?.schemaJson.fields ?? [])
      .filter((campo) => !esCampoDeApertura(campo))
      .sort((a, b) => a.order - b.order),
  );

  /** Integrantes que deben firmar el término de la jornada. */
  readonly firmantesCierre = computed(() =>
    this.perfil()?.firmaCierre ? (this.envio()?.members ?? []).map((miembro) => miembro.collaborator) : [],
  );
  readonly firmanteCierre = computed(() => this.firmantesCierre()[this.indiceFirmaCierre()] ?? null);
  readonly firmasCierreCompletas = computed(() =>
    this.firmantesCierre().every((persona) => Boolean(this.firmasCierre()[persona.id])),
  );

  readonly bloqueActual = computed<Bloque | null>(() => this.bloques()[this.indiceBloque()] ?? null);

  readonly negativas = computed(() =>
    this.bloques()
      .flatMap((bloque) => bloque.campos)
      // Un "NO" o un "Incorrecto" es lo que Coordinación debe mirar primero.
      .filter((campo) => this.valor(campo.id) === 'NO' || this.valor(campo.id) === 'Incorrecto'),
  );

  readonly puedeRetroceder = computed(() => {
    const etapa = this.etapa();
    if (etapa === 'charla') return true;
    if (etapa === 'formulario') return this.indiceBloque() > 0 || true;
    return etapa === 'revision' || etapa === 'firma';
  });

  readonly porcentaje = computed(() =>
    calcularPorcentajeAvance(this.etapa(), this.indiceBloque(), this.bloques().length),
  );

  readonly rotuloEtapa = computed(() => {
    switch (this.etapa()) {
      case 'arl':
        return 'Verificación de ARL';
      case 'charla':
        return 'Charla de seguridad';
      case 'cuadrilla':
        return 'Cuadrilla del día';
      case 'formulario':
        return `${this.bloqueActual()?.titulo ?? ''} · ${this.indiceBloque() + 1} de ${this.bloques().length}`;
      case 'revision':
        return 'Revisión final';
      case 'firma':
        return `Firmas · ${this.indiceFirma() + 1} de ${this.integrantes().length}`;
      default:
        return 'Resultado';
    }
  });

  constructor() {
    this.cargar();
  }

  ngOnDestroy(): void {
    clearInterval(this.sondeo);
  }

  // ── Navegación ───────────────────────────────────────────
  puedeAvanzar(): boolean {
    const etapa = this.etapa();
    if (etapa === 'arl') return this.flujo()?.canContinue === true;
    if (etapa === 'charla') return this.charlaTerminada() && this.charlaConfirmada() && !!this.charlaToken();
    // Al menos el oficial; el resto de la cuadrilla es opcional.
    if (etapa === 'cuadrilla') return this.integrantes().length > 0;
    return true;
  }

  siguiente(): void {
    const etapa = this.etapa();
    if (etapa === 'arl') return this.etapa.set(this.perfil()?.charla ? 'charla' : 'cuadrilla');
    if (etapa === 'charla') return this.etapa.set('cuadrilla');
    if (etapa === 'cuadrilla') return this.etapa.set('formulario');
    if (etapa !== 'formulario') return;

    // Solo se valida la sección visible: exigir el formulario completo aquí
    // dejaría al colaborador atascado sin saber qué falta ni dónde.
    const pendientes = (this.bloqueActual()?.campos ?? []).filter((campo) => this.faltaValor(campo));
    this.faltantes.set(pendientes.map((campo) => campo.id));
    if (pendientes.length) {
      this.enfocar(pendientes[0].id);
      return;
    }
    this.guardarBorrador();
    if (this.indiceBloque() + 1 < this.bloques().length) {
      this.indiceBloque.update((indice) => indice + 1);
      globalThis.scrollTo({ top: 0 });
      return;
    }
    this.etapa.set('revision');
    globalThis.scrollTo({ top: 0 });
  }

  atras(): void {
    this.faltantes.set([]);
    const etapa = this.etapa();
    if (etapa === 'charla') return this.etapa.set('arl');
    if (etapa === 'cuadrilla') return this.etapa.set(this.perfil()?.charla ? 'charla' : 'arl');
    if (etapa === 'firma') {
      if (this.indiceFirma() > 0) {
        this.indiceFirma.update((indice) => indice - 1);
        this.limpiarFirma();
        return;
      }
      return this.etapa.set('revision');
    }
    if (etapa === 'revision') {
      this.indiceBloque.set(this.bloques().length - 1);
      return this.etapa.set('formulario');
    }
    if (etapa === 'formulario') {
      if (this.indiceBloque() === 0) return this.etapa.set('cuadrilla');
      this.indiceBloque.update((indice) => indice - 1);
    }
  }

  volverA(bloque: Bloque): void {
    const indice = this.bloques().findIndex((candidato) => candidato.titulo === bloque.titulo);
    if (indice < 0) return;
    this.indiceBloque.set(indice);
    this.etapa.set('formulario');
    globalThis.scrollTo({ top: 0 });
  }

  reproducirCharla(): void {
    const video = this.videoCharla?.nativeElement;
    if (!video || this.charlaPreparando()) return;
    if (this.charlaTerminada()) {
      video.currentTime = 0;
      this.charlaTerminada.set(false);
      this.charlaConfirmada.set(false);
    }
    this.charlaToken.set(null);
    this.charlaPreparando.set(true);
    const videoId = this.charlaActual()
      .split('/')
      .at(-1)
      ?.replace(/\.mp4$/, '');
    this.http.post<{ token: string }>('/api/submissions/safety-talk/challenge', { videoId }).subscribe({
      next: ({ token }) => {
        this.charlaToken.set(token);
        this.charlaPreparando.set(false);
        void video.play().catch(() => {
          this.charlaToken.set(null);
          this.error.set('No fue posible reproducir la charla. Inténtalo de nuevo.');
        });
      },
      error: () => {
        this.charlaPreparando.set(false);
        this.error.set('No fue posible preparar la charla. Revisa tu conexión.');
      },
    });
  }

  bloquearAdelanto(): void {
    const video = this.videoCharla?.nativeElement;
    if (!video || this.charlaTerminada()) return;
    if (video.currentTime > this.ultimoSegundoPermitido + 1) video.currentTime = this.ultimoSegundoPermitido;
  }

  registrarProgresoCharla(): void {
    const video = this.videoCharla?.nativeElement;
    if (video && !video.seeking) this.ultimoSegundoPermitido = Math.max(this.ultimoSegundoPermitido, video.currentTime);
  }

  finalizarCharla(): void {
    this.charlaTerminada.set(true);
    this.ultimoSegundoPermitido = 0;
    this.error.set('');
  }

  reportarErrorVideo(): void {
    this.error.set('No se encontró la charla de seguridad. Verifica que los videos estén en la carpeta configurada.');
  }

  // ── Cuadrilla ────────────────────────────────────────────
  estaEnCuadrilla(collaboratorId: string): boolean {
    return this.integrantes().some((persona) => persona.candidato.id === collaboratorId);
  }

  alternarIntegrante(candidato: Candidato): void {
    // El oficial no puede quitarse: es quien responde por el permiso.
    if (candidato.id === this.yoId()) return;
    if (this.cuadrillaCompleta() && !this.estaEnCuadrilla(candidato.id)) return;
    this.integrantes.update((lista) =>
      lista.some((persona) => persona.candidato.id === candidato.id)
        ? lista.filter((persona) => persona.candidato.id !== candidato.id)
        : [...lista, { candidato, jobPositionId: this.cargoPorDefecto(candidato), firmaDataUrl: null }],
    );
  }

  asignarCargo(collaboratorId: string, jobPositionId: string): void {
    this.integrantes.update((lista) =>
      lista.map((persona) => (persona.candidato.id === collaboratorId ? { ...persona, jobPositionId } : persona)),
    );
  }

  /** Lo que el sistema pondrá en un campo automático, mostrado por adelantado. */
  valorAutomatico(campo: Campo): string {
    return obtenerValorAutomatico(campo, this.flujo()?.cumplimiento);
  }

  explicacionAuto(campo: Campo): string {
    return obtenerExplicacionAuto(campo);
  }

  nombreCargo(jobPositionId: string): string {
    return this.cargos().find((cargo) => cargo.id === jobPositionId)?.name ?? 'Sin cargo';
  }

  // ── Firma guiada, una persona a la vez ───────────────────
  /**
   * Guarda la firma del integrante actual y pasa al siguiente. Cuando ya
   * firmaron todos, envía el permiso completo.
   */
  confirmarFirma(): void {
    const lienzo = this.lienzo?.nativeElement;
    const actual = this.firmante();
    if (!lienzo || !actual || !this.hayFirma()) return;

    const dataUrl = this.firmaSobreBlanco(lienzo);
    this.integrantes.update((lista) =>
      lista.map((persona) =>
        persona.candidato.id === actual.candidato.id ? { ...persona, firmaDataUrl: dataUrl } : persona,
      ),
    );

    if (!this.esUltimoFirmante()) {
      this.indiceFirma.update((indice) => indice + 1);
      this.limpiarFirma();
      globalThis.scrollTo({ top: 0 });
      return;
    }
    this.enviar();
  }

  // ── Cierre de jornada ────────────────────────────────────
  iniciarJornada(submissionId: string): void {
    if (this.iniciando()) return;
    this.iniciando.set(true);
    this.error.set('');
    this.http.post<{ startedAt: string }>(`/api/submissions/${submissionId}/start`, {}).subscribe({
      next: ({ startedAt }) => {
        this.envio.update((actual) => (actual ? { ...actual, startedAt } : actual));
        this.iniciando.set(false);
      },
      error: (respuesta: HttpErrorResponse) => {
        this.error.set(respuesta.error?.message || 'No fue posible iniciar la jornada.');
        this.iniciando.set(false);
      },
    });
  }

  cerrarJornada(submissionId: string): void {
    if (this.cerrando()) return;
    const pendientes = this.camposCierre().filter((campo) => this.faltaValorEn(this.respuestasCierre, campo));
    this.faltantesCierre.set(pendientes.map((campo) => campo.id));
    if (pendientes.length) {
      this.enfocar(pendientes[0].id);
      return;
    }
    if (!this.firmasCierreCompletas()) return;
    this.cerrando.set(true);
    this.error.set('');
    const firmas = this.firmasCierre();
    this.http
      .post<Envio>(`/api/submissions/${submissionId}/close`, {
        notes: this.novedades().trim() || undefined,
        answers: this.camposCierre().length ? this.respuestasCierre.getRawValue() : undefined,
        signatures: this.firmantesCierre().length
          ? this.firmantesCierre().map((persona) => ({
              collaboratorId: persona.id,
              signatureDataUrl: firmas[persona.id],
            }))
          : undefined,
      })
      .subscribe({
        next: (resultado) => {
          this.envio.set(resultado);
          this.cerrando.set(false);
          globalThis.scrollTo({ top: 0 });
        },
        error: (respuesta: HttpErrorResponse) => {
          const detalle = respuesta.error?.message;
          this.error.set(
            typeof detalle === 'string'
              ? detalle
              : 'No fue posible cerrar la jornada. Revisa tu conexión e inténtalo de nuevo.',
          );
          this.cerrando.set(false);
        },
      });
  }

  /** Respuesta de un campo de cierre (botones Sí/No). */
  elegirCierre(id: string, opcion: string): void {
    this.respuestasCierre.get(id)?.setValue(opcion);
    if (this.faltantesCierre().includes(id))
      this.faltantesCierre.update((lista) => lista.filter((otro) => otro !== id));
  }

  valorCierre(id: string): unknown {
    return this.respuestasCierre.get(id)?.value;
  }

  invalidoCierre(campo: Campo): boolean {
    return this.faltantesCierre().includes(campo.id);
  }

  /** Guarda la firma de término del integrante actual y pasa al siguiente. */
  confirmarFirmaCierre(): void {
    const lienzo = this.lienzo?.nativeElement;
    const persona = this.firmanteCierre();
    if (!lienzo || !persona || !this.hayFirma()) return;
    const dataUrl = this.firmaSobreBlanco(lienzo);
    this.firmasCierre.update((firmas) => ({ ...firmas, [persona.id]: dataUrl }));
    this.limpiarFirma();
    if (this.indiceFirmaCierre() < this.firmantesCierre().length - 1) this.indiceFirmaCierre.update((i) => i + 1);
  }

  repetirFirmasCierre(): void {
    this.firmasCierre.set({});
    this.indiceFirmaCierre.set(0);
    this.limpiarFirma();
  }

  hora(valor: string | null | undefined): string {
    if (!valor) return '—';
    return new Date(valor).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    });
  }

  /** El oficial diligencia el permiso y el resto de la cuadrilla inicia como ayudante. */
  private cargoPorDefecto(candidato: Candidato): string {
    const lista = this.cargos();
    const esLider = candidato.id === this.yoId();
    const preferido = esLider
      ? (lista.find((cargo) => cargo.code === 'OFICIAL_ELECTRICO') ?? lista.find((cargo) => cargo.canLead))
      : (lista.find((cargo) => cargo.code === 'AYUDANTE') ?? lista.find((cargo) => !cargo.canLead));
    return (preferido ?? lista[0])?.id ?? '';
  }

  // ── Campos ───────────────────────────────────────────────
  esBotonera(campo: Campo): boolean {
    if (campo.type === 'yes_no') return true;
    // Un desplegable de pocas opciones cortas se responde mejor con botones.
    return campo.type === 'select' && (campo.options?.length ?? 0) <= 3;
  }

  /** El tipo `yes_no` no declara opciones en el esquema: las aporta la vista. */
  opcionesDe(campo: Campo): string[] {
    return campo.type === 'yes_no' ? ['SI', 'NO'] : (campo.options ?? []);
  }

  textoOpcion(opcion: string): string {
    if (opcion === 'SI') return 'Sí';
    if (opcion === 'NO') return 'No';
    return opcion;
  }

  valor(id: string): unknown {
    return this.respuestas.get(id)?.value;
  }

  textoValor(id: string): string {
    const campo = this.bloques()
      .flatMap((bloque) => bloque.campos)
      .find((candidato) => candidato.id === id);
    if (campo?.type === 'auto') return this.valorAutomatico(campo);
    const valor = this.valor(id);
    if (valor === null || valor === undefined || valor === '') return '—';
    if (Array.isArray(valor)) return valor.length ? valor.join(', ') : '—';
    return this.textoOpcion(String(valor));
  }

  elegir(id: string, opcion: string): void {
    this.respuestas.get(id)?.setValue(opcion);
    if (id === 'epp_otros' && opcion !== 'SI') this.respuestas.get('epp_otros_detalle')?.setValue('');
    if (id === 'otras_tar_involucradas' && opcion !== 'SI') {
      this.respuestas.get('otras_tar')?.setValue([]);
      this.respuestas.get('otras_tar_detalle')?.setValue('');
    }
    this.descartarFaltante(id);
  }

  /** Muestra los campos de detalle solo cuando la respuesta que los activa está seleccionada. */
  debeMostrarCampo(id: string): boolean {
    if (id === 'otras_tar') return this.valor('otras_tar_involucradas') === 'SI';
    if (id === 'otras_tar_detalle') return this.tieneOpcion('otras_tar', 'Otras');
    if (id === 'epp_otros_detalle') return this.valor('epp_otros') === 'SI';
    return true;
  }

  tieneOpcion(id: string, opcion: string): boolean {
    const valor = this.valor(id);
    return Array.isArray(valor) && valor.includes(opcion);
  }

  alternar(id: string, opcion: string): void {
    const control = this.respuestas.get(id);
    const actual = Array.isArray(control?.value) ? [...(control.value as string[])] : [];
    const indice = actual.indexOf(opcion);
    if (indice >= 0) {
      actual.splice(indice, 1);
      // Un detalle oculto no debe viajar como respuesta si ya no se marcó “Otras”.
      if (id === 'otras_tar' && opcion === 'Otras') this.respuestas.get('otras_tar_detalle')?.setValue('');
    } else actual.push(opcion);
    control?.setValue(actual);
    this.descartarFaltante(id);
  }

  invalido(campo: Campo): boolean {
    return this.faltantes().includes(campo.id);
  }

  // ── Firma ────────────────────────────────────────────────
  iniciarTrazo(evento: PointerEvent): void {
    const lienzo = this.prepararLienzo();
    if (!lienzo) return;
    this.dibujando = true;
    lienzo.setPointerCapture(evento.pointerId);
    lienzo.getContext('2d')?.beginPath();
    this.trazar(evento);
  }

  trazar(evento: PointerEvent): void {
    if (!this.dibujando) return;
    const lienzo = this.lienzo?.nativeElement;
    const contexto = lienzo?.getContext('2d');
    if (!lienzo || !contexto) return;
    const marco = lienzo.getBoundingClientRect();
    const x = (evento.clientX - marco.left) * (lienzo.width / marco.width);
    const y = (evento.clientY - marco.top) * (lienzo.height / marco.height);
    contexto.lineWidth = 3.5;
    contexto.lineCap = 'round';
    contexto.lineJoin = 'round';
    contexto.strokeStyle = '#111827';
    contexto.lineTo(x, y);
    contexto.stroke();
    contexto.beginPath();
    contexto.moveTo(x, y);
    this.hayFirma.set(true);
  }

  terminarTrazo(evento: PointerEvent): void {
    this.dibujando = false;
    this.lienzo?.nativeElement.getContext('2d')?.beginPath();
    if (this.lienzo?.nativeElement.hasPointerCapture(evento.pointerId)) {
      this.lienzo.nativeElement.releasePointerCapture(evento.pointerId);
    }
  }

  limpiarFirma(): void {
    const lienzo = this.lienzo?.nativeElement;
    if (!lienzo) return;
    lienzo.getContext('2d')?.clearRect(0, 0, lienzo.width, lienzo.height);
    this.hayFirma.set(false);
  }

  /** Ajusta el búfer del lienzo al tamaño real que ocupa en pantalla. */
  private prepararLienzo(): HTMLCanvasElement | null {
    const lienzo = this.lienzo?.nativeElement;
    if (!lienzo) return null;
    const marco = lienzo.getBoundingClientRect();
    const escala = Math.min(globalThis.devicePixelRatio || 1, 2);
    const ancho = Math.round(marco.width * escala);
    const alto = Math.round(marco.height * escala);
    // Redimensionar borra el trazo, así que solo se hace antes del primero.
    if (!this.hayFirma() && (lienzo.width !== ancho || lienzo.height !== alto)) {
      lienzo.width = ancho;
      lienzo.height = alto;
    }
    return lienzo;
  }

  // ── Envío ────────────────────────────────────────────────
  enviar(): void {
    const cuadrilla = this.integrantes();
    const conCharla = this.perfil()?.charla === true;
    if (this.enviando() || (conCharla && !this.charlaToken()) || !cuadrilla.every((persona) => persona.firmaDataUrl))
      return;
    this.enviando.set(true);
    this.error.set('');
    this.http
      .post<Envio>(`/api/submissions/forms/${this.codigo}`, {
        answers: this.respuestasNormalizadas(),
        ...(conCharla ? { safetyTalkConfirmed: true, safetyTalkToken: this.charlaToken() } : {}),
        previousSubmissionId: this.correccion()?.id,
        members: cuadrilla.map((persona) => ({
          collaboratorId: persona.candidato.id,
          jobPositionId: persona.jobPositionId || undefined,
          signatureDataUrl: persona.firmaDataUrl,
        })),
      })
      .subscribe({
        next: (resultado) => {
          this.envio.set(resultado);
          this.enviando.set(false);
          this.etapa.set('resultado');
          this.borrarBorrador();
          this.sondearEstado();
          globalThis.scrollTo({ top: 0 });
        },
        error: (respuesta: HttpErrorResponse) => {
          const detalle = respuesta.error?.message;
          this.error.set(
            typeof detalle === 'string'
              ? detalle
              : 'No fue posible enviar el permiso. Revisa los datos diligenciados e inténtalo de nuevo.',
          );
          this.enviando.set(false);
        },
      });
  }

  consultarEstado(): void {
    this.consultando.set(true);
    this.http.get<Envio>('/api/submissions/mine/latest', { params: { form: this.codigo } }).subscribe({
      next: (resultado) => {
        this.envio.set(resultado);
        this.consultando.set(false);
        if (resultado && resultado.status !== 'PENDING_APPROVAL') clearInterval(this.sondeo);
      },
      error: () => this.consultando.set(false),
    });
  }

  soloFecha(valor: string): string {
    return fechaCalendario(valor, true);
  }

  claseArl(): string {
    const estado = this.flujo()?.arl.status;
    if (estado === 'VIGENTE') return 'vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'por-vencer';
    return 'vencida';
  }

  textoArl(): string {
    const estado = this.flujo()?.arl.status;
    if (estado === 'VIGENTE') return 'Vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'Próxima a vencer';
    return 'Vencida';
  }

  /** Indica el requisito real que bloquea el permiso; no atribuye el bloqueo a la ARL si está vigente. */
  requisitosPendientes(): string {
    const faltantes = this.flujo()?.cumplimiento?.faltantes ?? [];
    return faltantes.length ? faltantes.join(', ') : 'un requisito obligatorio';
  }

  // ── Interno ──────────────────────────────────────────────
  private cargar(): void {
    if (!this.formato) {
      this.error.set('Este formato no existe. Vuelve a la lista de formatos.');
      return;
    }
    this.http.get<Flujo>('/api/submissions/workflow', { params: { form: this.codigo } }).subscribe({
      next: (flujo) => {
        this.flujo.set(flujo);
        // Una jornada sin cerrar se retoma donde quedó, no se empieza otra.
        if (flujo.jornadaAbierta) return this.retomarJornada();
        if (!flujo.canContinue) return;
        this.cargarDefinicion();
        this.cargarCuadrilla();
        const corregir = this.ruta.snapshot.queryParamMap.get('corregir');
        if (corregir) this.cargarCorreccion(corregir);
        else this.buscarRechazoPendiente();
      },
      error: () => this.error.set('No fue posible validar tu estado. Revisa tu conexión.'),
    });
  }

  /** Candidatos elegibles y cargos; el oficial entra ya seleccionado. */
  private cargarCuadrilla(): void {
    this.http.get<Cargo[]>('/api/submissions/job-positions').subscribe({
      next: (cargos) => {
        this.cargos.set(cargos);
        const params = { form: this.codigo };
        this.http
          .get<{ candidates: Candidato[]; excluded: number }>('/api/submissions/crew-candidates', { params })
          .subscribe({
            next: (respuesta) => {
              this.candidatos.set(respuesta.candidates);
              this.excluidos.set(respuesta.excluded);
              const documento = this.flujo()?.collaborator.documentNumber;
              const yo = respuesta.candidates.find((persona) => persona.documentNumber === documento);
              if (!yo) return;
              this.yoId.set(yo.id);
              this.integrantes.set([{ candidato: yo, jobPositionId: this.cargoPorDefecto(yo), firmaDataUrl: null }]);
              this.aplicarCorreccion();
            },
            error: () => this.error.set('No fue posible cargar los colaboradores disponibles.'),
          });
      },
      error: () => this.error.set('No fue posible cargar los cargos.'),
    });
  }

  /**
   * Abre el formulario en modo corrección. Se recarga la página a propósito:
   * el flujo arranca limpio (charla, cuadrilla y firmas nuevas) en vez de
   * reutilizar el estado del permiso rechazado que se está mostrando.
   */
  corregir(submissionId: string): void {
    globalThis.location.assign(`/formulario/${this.formato?.slug}?corregir=${encodeURIComponent(submissionId)}`);
  }

  private cargarCorreccion(submissionId: string): void {
    this.http.get<Correccion>(`/api/submissions/mine/${submissionId}/correction`).subscribe({
      next: (correccion) => {
        this.correccion.set(correccion);
        this.aplicarCorreccion();
      },
      error: (respuesta: HttpErrorResponse) => {
        const detalle = respuesta.error?.message;
        this.error.set(
          typeof detalle === 'string'
            ? `${detalle} Puedes diligenciar un permiso nuevo.`
            : 'No fue posible recuperar el permiso rechazado. Puedes diligenciar uno nuevo.',
        );
      },
    });
  }

  private buscarRechazoPendiente(): void {
    this.http.get<Envio>('/api/submissions/mine/latest', { params: { form: this.codigo } }).subscribe({
      next: (ultimo) => {
        if (ultimo?.status === 'REJECTED' && ultimo.correctable) {
          this.rechazoPendiente.set({ id: ultimo.id, reason: ultimo.approval?.reason ?? null });
        }
      },
      error: () => undefined,
    });
  }

  /**
   * Precarga respuestas y cuadrilla del permiso rechazado. Espera a tener el
   * formato y los candidatos: sin ellos no hay controles ni personas elegibles.
   */
  private aplicarCorreccion(): void {
    const correccion = this.correccion();
    if (this.correccionAplicada || !correccion || !this.definicion() || !this.yoId()) return;
    this.correccionAplicada = true;

    for (const [id, valor] of Object.entries(correccion.answers)) this.respuestas.get(id)?.setValue(valor);

    const cargos = new Set(this.cargos().map((cargo) => cargo.id));
    const elegibles = new Map(this.candidatos().map((candidato) => [candidato.id, candidato]));
    const cuadrilla: Integrante[] = [];
    let omitidos = 0;
    // El oficial primero, como en un permiso nuevo; luego el resto en su orden.
    const ordenados = [...correccion.members].sort((a, b) => Number(b.isLead) - Number(a.isLead));
    for (const integrante of ordenados.slice(0, this.maxIntegrantes())) {
      const candidato = elegibles.get(integrante.collaboratorId);
      if (!candidato) {
        omitidos++;
        continue;
      }
      const jobPositionId =
        integrante.jobPositionId && cargos.has(integrante.jobPositionId)
          ? integrante.jobPositionId
          : this.cargoPorDefecto(candidato);
      cuadrilla.push({ candidato, jobPositionId, firmaDataUrl: null });
    }
    if (cuadrilla.some((persona) => persona.candidato.id === this.yoId())) this.integrantes.set(cuadrilla);
    this.omitidosCorreccion.set(omitidos);
  }

  /** Salta al resultado para que el colaborador pueda cerrar lo que dejó abierto. */
  private retomarJornada(): void {
    // Los campos de cierre necesitan el formato cargado para tener sus controles.
    this.cargarDefinicion();
    this.http.get<Envio>('/api/submissions/mine/latest', { params: { form: this.codigo } }).subscribe({
      next: (resultado) => {
        this.envio.set(resultado);
        this.etapa.set('resultado');
      },
      error: () => this.error.set('No fue posible recuperar tu jornada en curso.'),
    });
  }

  private cargarDefinicion(): void {
    this.http.get<Definicion>(`/api/forms/${this.codigo}/current`).subscribe({
      next: (definicion) => {
        for (const campo of definicion.schemaJson.fields) {
          // Un campo automático no se diligencia: lo completa el servidor.
          if (campo.type === 'auto') continue;
          const grupo = esCampoDeApertura(campo) ? this.respuestas : this.respuestasCierre;
          grupo.addControl(
            campo.id,
            new FormControl<unknown>(
              campo.type === 'multi_select' ? [] : '',
              campo.required ? Validators.required : [],
            ),
          );
        }
        this.definicion.set(definicion);
        this.restaurarBorrador();
        this.aplicarCorreccion();
      },
      error: () => this.error.set('No fue posible cargar el formato vigente.'),
    });
  }

  private faltaValor(campo: Campo): boolean {
    if (!this.debeMostrarCampo(campo.id)) return false;
    return this.faltaValorEn(this.respuestas, campo);
  }

  private faltaValorEn(grupo: FormGroup<Record<string, FormControl<unknown>>>, campo: Campo): boolean {
    if (campo.type === 'auto' || !esObligatorio(campo, (id) => grupo.get(id)?.value)) return false;
    const valor = grupo.get(campo.id)?.value;
    if (Array.isArray(valor)) return valor.length === 0;
    return valor === null || valor === undefined || (typeof valor === 'string' && !valor.trim());
  }

  private descartarFaltante(id: string): void {
    if (this.faltantes().includes(id)) this.faltantes.update((lista) => lista.filter((otro) => otro !== id));
  }

  private enfocar(id: string): void {
    globalThis.setTimeout(() => {
      const elemento = document.querySelector<HTMLElement>(`[id="${id}-etiqueta"], [formcontrolname="${id}"]`);
      elemento?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  private respuestasNormalizadas(): Record<string, unknown> {
    return normalizarRespuestasFormulario(
      this.respuestas.getRawValue(),
      this.definicion()?.schemaJson.fields.filter(esCampoDeApertura),
    );
  }

  /**
   * El lienzo es transparente y el PDF final va sobre papel blanco: sin este
   * fondo la firma se pierde al imprimir.
   */
  private firmaSobreBlanco(lienzo: HTMLCanvasElement): string {
    const plano = document.createElement('canvas');
    plano.width = lienzo.width;
    plano.height = lienzo.height;
    const contexto = plano.getContext('2d');
    if (!contexto) return lienzo.toDataURL('image/png');
    contexto.fillStyle = '#ffffff';
    contexto.fillRect(0, 0, plano.width, plano.height);
    contexto.drawImage(lienzo, 0, 0);
    return plano.toDataURL('image/png');
  }

  private sondearEstado(): void {
    clearInterval(this.sondeo);
    this.sondeo = setInterval(() => {
      if (this.envio()?.status === 'PENDING_APPROVAL') this.consultarEstado();
      else clearInterval(this.sondeo);
    }, 20_000);
  }

  // ── Borrador local ───────────────────────────────────────
  // Protege lo diligenciado si la aplicación se cierra a media jornada. No
  // sustituye a un borrador en servidor, que sigue siendo decisión pendiente.
  /** Un borrador por formato: diligenciar el ATS no debe pisar el permiso de alturas. */
  private claveBorrador(): string {
    return this.codigo === 'HSE-FO-016' ? BORRADOR : `${BORRADOR}.${this.codigo}`;
  }

  private guardarBorrador(): void {
    try {
      const documento = this.flujo()?.collaborator.documentNumber ?? '';
      localStorage.setItem(this.claveBorrador(), JSON.stringify({ documento, valores: this.respuestas.getRawValue() }));
    } catch {
      // Modo privado o almacenamiento lleno: el flujo continúa sin borrador.
    }
  }

  private restaurarBorrador(): void {
    try {
      const crudo = localStorage.getItem(this.claveBorrador());
      if (!crudo) return;
      const guardado = JSON.parse(crudo) as { documento?: string; valores?: Record<string, unknown> };
      // El borrador de otro colaborador no debe aparecer en este dispositivo.
      if (guardado.documento !== this.flujo()?.collaborator.documentNumber) return this.borrarBorrador();
      for (const [id, valor] of Object.entries(guardado.valores ?? {})) this.respuestas.get(id)?.setValue(valor);
    } catch {
      this.borrarBorrador();
    }
  }

  private borrarBorrador(): void {
    try {
      localStorage.removeItem(this.claveBorrador());
    } catch {
      // Sin almacenamiento no hay nada que borrar.
    }
  }
}

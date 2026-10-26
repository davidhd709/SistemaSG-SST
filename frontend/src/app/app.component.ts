import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AvisoVersionComponent } from './core/aviso-version.component';
import { rotularTablasEnFichas } from './core/tablas-en-fichas';

@Component({
  selector: 'sg-root',
  imports: [RouterOutlet, AvisoVersionComponent],
  template: '<router-outlet /><sg-aviso-version />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  constructor() {
    const raiz = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => destroyRef.onDestroy(rotularTablasEnFichas(raiz)));
  }
}

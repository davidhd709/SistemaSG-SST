import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AvisoVersionComponent } from './core/aviso-version.component';

@Component({
  selector: 'sg-root',
  imports: [RouterOutlet, AvisoVersionComponent],
  template: '<router-outlet /><sg-aviso-version />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}

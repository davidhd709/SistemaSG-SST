import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AvisoVersionComponent } from './aviso-version.component';

describe('AvisoVersionComponent', () => {
  it('muestra el aviso solo cuando una versión nueva está lista', async () => {
    const versiones = new Subject<VersionEvent>();
    const sw = {
      isEnabled: true,
      versionUpdates: versiones,
      unrecoverable: new Subject(),
      checkForUpdate: jasmine.createSpy('checkForUpdate').and.resolveTo(false),
      activateUpdate: jasmine.createSpy('activateUpdate').and.resolveTo(true),
    };
    await TestBed.configureTestingModule({
      imports: [AvisoVersionComponent],
      providers: [{ provide: SwUpdate, useValue: sw }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AvisoVersionComponent);
    fixture.detectChanges();

    expect(sw.checkForUpdate).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.aviso')).toBeNull();

    versiones.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.aviso')).toBeNull();

    versiones.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.aviso')?.textContent).toContain('Hay una versión nueva');
    fixture.destroy();
  });
});

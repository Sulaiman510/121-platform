import { HttpClientTestingModule } from '@angular/common/http/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { UserRole } from 'src/app/auth/user-role.enum';
import { provideMagicalMock } from 'src/app/mocks/helpers';
import { ProgramPhase } from 'src/app/models/program.model';
import {
  Phase,
  ProgramPhaseService,
} from 'src/app/services/program-phase.service';
import { ExportInclusionComponent } from './export-inclusion.component';

describe('ExportInclusionComponent', () => {
  let component: ExportInclusionComponent;
  let fixture: ComponentFixture<ExportInclusionComponent>;

  const mockProgramId = 1;
  const mockUserRole = UserRole.ProjectOfficer;

  const mockProgramPhase: Phase = {
    id: 1,
    name: ProgramPhase.design,
    label: 'label',
    btnText: 'btnText',
    active: true,
  };

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ExportInclusionComponent],
      imports: [TranslateModule.forRoot(), HttpClientTestingModule],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [provideMagicalMock(ProgramPhaseService)],
    }).compileComponents();
  }));

  let mockProgramPhaseService: jasmine.SpyObj<ProgramPhaseService>;
  beforeEach(() => {
    mockProgramPhaseService = TestBed.get(ProgramPhaseService);
    mockProgramPhaseService.getActivePhase.and.returnValue(mockProgramPhase);

    fixture = TestBed.createComponent(ExportInclusionComponent);
    component = fixture.componentInstance;

    component.programId = mockProgramId;
    component.userRole = mockUserRole;

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

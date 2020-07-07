import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { ExportInclusionComponent } from 'src/app/program/export-inclusion/export-inclusion.component';
import { SharedModule } from 'src/app/shared/shared.module';
import { ReviewInclusionPage } from './review-inclusion.page';

const routes: Routes = [
  {
    path: '',
    component: ReviewInclusionPage,
  },
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    RouterModule.forChild(routes),
  ],
  declarations: [ReviewInclusionPage, ExportInclusionComponent],
})
export class ReviewInclusionPageModule {}

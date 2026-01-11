import { Routes } from '@angular/router';
import { ProdutosListaComponent } from './features/produtos/produtos-lista.component';
import { NotasListaComponent } from './features/notas/notas-lista.component';
import { NotaDetalhesComponent } from './features/notas/nota-detalhes.component';

export const routes: Routes = [
  { path: '', redirectTo: '/produtos', pathMatch: 'full' },
  { path: 'produtos', component: ProdutosListaComponent },
  { path: 'notas', component: NotasListaComponent },
  { path: 'notas/:id', component: NotaDetalhesComponent },
  { path: '**', redirectTo: '/produtos' }
];

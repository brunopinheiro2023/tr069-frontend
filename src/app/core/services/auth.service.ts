// Caminho do arquivo: frontend/src/app/core/services/auth.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly AUTH_URL = `${environment.apiUrl}/auth`;

  // BehaviorSubject mantém o estado atual da autenticação para que os componentes saibam se o usuário está logado
  private authStatus = new BehaviorSubject<boolean>(this.hasToken());

  constructor(private http: HttpClient) {}

  /**
   * Envia as credenciais para o backend e armazena o token recebido.
   * Utilizamos o operador 'tap' do RxJS para interceptar a resposta sem alterar o fluxo do Observable.
   */
  login(credentials: any): Observable<any> {
    return this.http.post(`${this.AUTH_URL}/login`, credentials).pipe(
      tap((response: any) => {
        if (response && response.token) {
          localStorage.setItem('jwt_token', response.token); // Salva o token no navegador
          this.authStatus.next(true); // Atualiza o estado global para "logado"
        }
      })
    );
  }

  /**
   * Remove o token e atualiza o estado de autenticação para falso.
   */
  logout(): void {
    localStorage.removeItem('jwt_token');
    this.authStatus.next(false);
  }

  /**
   * Retorna o token armazenado no localStorage.
   */
  getToken(): string | null {
    return localStorage.getItem('jwt_token');
  }

  /**
   * Verifica se existe um token no localStorage (Validação simples de existência).
   */
  private hasToken(): boolean {
    return !!localStorage.getItem('jwt_token');
  }

  /**
   * Permite que os componentes assinem (subscribe) o estado de autenticação em tempo real.
   */
  isLoggedIn(): Observable<boolean> {
    return this.authStatus.asObservable();
  }
}

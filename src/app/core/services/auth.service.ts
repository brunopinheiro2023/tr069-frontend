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
    // Fire and forget: notifica o backend para invalidar o cookie HTTP-Only
    this.http.post(`${this.AUTH_URL}/logout`, {}, { withCredentials: true }).subscribe({
      next: () => {},
      error: () => {} // Ignora falhas silenciosamente se o servidor estiver fora do ar
    });
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
   * Solicita um novo Access Token usando o Refresh Token armazenado no cookie HTTP-Only.
   */
  refreshToken(): Observable<any> {
    // withCredentials: true instrui o navegador a enviar o cookie HTTP-Only seguro.
    return this.http.post<any>(`${this.AUTH_URL}/refresh`, {}, { withCredentials: true });
  }

  /**
   * Atualiza o Access Token em memória/localStorage após uma renovação bem-sucedida.
   */
  setToken(token: string): void {
    localStorage.setItem('jwt_token', token);
    this.authStatus.next(true);
  }

  /**
   * Permite que os componentes assinem (subscribe) o estado de autenticação em tempo real.
   */
  isLoggedIn(): Observable<boolean> {
    return this.authStatus.asObservable();
  }

  /**
   * Decodifica o payload do token JWT para extrair informações do usuário.
   * @returns O payload decodificado ou null se o token for inválido/inexistente.
   */
  private getUserPayload(): { id: string; username: string; role: string } | null {
    const token = this.getToken();
    if (!token) {
      return null;
    }

    try {
      // O payload é a segunda parte do token JWT (header.payload.signature)
      const payloadBase64Url = token.split('.')[1];
      // Converte de Base64Url para Base64 padrão
      const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
      const decodedPayload = JSON.parse(window.atob(payloadBase64));
      return decodedPayload;
    } catch (error) {
      console.error('Erro ao decodificar token JWT:', error);
      this.logout(); // O token é inválido, desloga o usuário
      return null;
    }
  }

  /**
   * Obtém o nome de usuário (username) a partir do token JWT armazenado.
   */
  getUsername(): string | null {
    const payload = this.getUserPayload();
    return payload ? payload.username : null;
  }

  /**
   * Obtém o role do usuário a partir do token JWT armazenado.
   */
  getRole(): string | null {
    const payload = this.getUserPayload();
    return payload ? payload.role : null;
  }

  /**
   * Verifica se o usuário tem role de admin.
   */
  isAdmin(): boolean {
    return this.getRole() === 'admin';
  }
}

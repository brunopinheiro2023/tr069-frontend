import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;

  constructor(private authService: AuthService, private router: Router) {}

  onSubmit(): void {
    if (!this.username || !this.password) {
      this.errorMessage = 'Preencha usuário e senha.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.login({ username: this.username, password: this.password }).subscribe({
      next: () => {
        // Se o login der certo, o AuthInterceptor já cuidará do Token.
        // Apenas redirecionamos para o Dashboard.
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Erro de Login:', err);

        // Trata erro 400 (Bad Request) vindo do Zod Validation
        if (err.status === 400) {
          const zodErrors = err.error?.errors || err.error?.details;
          if (Array.isArray(zodErrors) && zodErrors.length > 0) {
            // Pega a primeira mensagem de erro da lista do Zod e exibe na tela
            this.errorMessage = zodErrors[0].message || 'Formato de dados inválido (Validação Zod).';
            return;
          }
        }

        // Adicionado: Mensagem específica para erro 404 do proxy
        if (err.status === 404) {
          this.errorMessage = 'Serviço de autenticação não encontrado. Verifique se o backend (Node.js) está rodando na porta 3000.';
          return;
        }

        // Fallback: Pega a mensagem de erro comum do Node.js (ex: Credenciais inválidas, 401)
        this.errorMessage = err.error?.error || 'Erro de conexão com o servidor.';
      }
    });
  }
}

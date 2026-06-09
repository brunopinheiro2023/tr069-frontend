// =============================================================================
// CAMINHO DO ARQUIVO: frontend/src/app/core/validators/zod-validators.ts
// =============================================================================
// Converte schemas Zod em Angular ValidatorFn para uso em Reactive Forms.
//
// Uso:
//   import { zodValidator } from './zod-validators';
//   import { wifiConfigSchema } from './schemas';
//
//   this.form = fb.group({
//     ssid: ['', [Validators.required, zodValidator(wifiConfigSchema.shape.ssid)]],
//     password: ['', [Validators.required, zodValidator(wifiConfigSchema.shape.password)]],
//   });
//
//   // Validação de objeto completo (para submit):
//   const result = wifiConfigSchema.safeParse(this.form.value);
//   if (!result.success) { ... }
// =============================================================================

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { z } from 'zod';

/**
 * Converte um Zod schema em um Angular ValidatorFn.
 * O schema deve ser um ZodType (ex: z.string().min(1), z.number(), etc.).
 *
 * @param schema - Schema Zod a ser validado
 * @returns Angular ValidatorFn
 */
export function zodValidator<T>(schema: z.ZodType<T>): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const result = schema.safeParse(control.value);
    if (result.success) {
      return null;
    }
    // Converte os issues do Zod em objeto de erros do Angular Form
    const errors: ValidationErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'zodError';
      if (!errors[key]) {
        errors[key] = [];
      }
      (errors[key] as string[]).push(issue.message);
    }
    return errors;
  };
}

/**
 * Valida um objeto completo contra um schema Zod (útil para validação
 * de formulário inteiro antes de enviar para a API).
 *
 * @param schema - Schema ZodObject
 * @param value - Valor a ser validado (ex: form.value)
 * @returns { isValid: true, data: T } | { isValid: false, errors: Record<string, string[]> }
 */
export function validateForm<T>(schema: z.ZodType<T>, value: unknown):
  | { isValid: true; data: T }
  | { isValid: false; errors: Record<string, string[]> } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { isValid: true, data: result.data };
  }
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = [];
    errors[key].push(issue.message);
  }
  return { isValid: false, errors };
}

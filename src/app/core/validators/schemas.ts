// =============================================================================
// CAMINHO DO ARQUIVO: frontend/src/app/core/validators/schemas.ts
// =============================================================================
// Schemas Zod compartilhados entre frontend e backend.
// Esses schemas espelham as regras do backend para garantir que dados enviados
// pela API passem na validação sem surpresas.
//
// Uso nos formulários Angular:
//   import { zodValidator } from './zod-validators';
//   this.form = fb.group({
//     ssid: ['', zodValidator(wifiConfigSchema.shape.ssid)],
//     password: ['', zodValidator(wifiConfigSchema.shape.password)],
//   });
// =============================================================================

import { z } from 'zod';

// ── HELPERS ─────────────────────────────────────────────────────────────────

const SERIAL_MAX_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const USERNAME_MAX_LENGTH = 64;

/** Regex para serial numbers: alfanumérico, hífen e ponto. */
const SERIAL_REGEX = /^[A-Za-z0-9\-.]{1,64}$/;

/** Regex para SSID. */
const SSID_REGEX = /^[\x20-\x7E]{1,32}$/;

/** Regex para senha Wi-Fi. */
const WIFI_PASSWORD_REGEX = /^[\x20-\x7E]{8,63}$/;

// =============================================================================
// 1. AUTENTICAÇÃO
// =============================================================================

export const loginSchema = z.object({
  username: z
    .string()
    .min(1, 'Usuário é obrigatório.')
    .max(USERNAME_MAX_LENGTH, `Usuário deve ter no máximo ${USERNAME_MAX_LENGTH} caracteres.`),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`)
    .max(PASSWORD_MAX_LENGTH, `Senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`),
});

export type LoginInput = z.infer<typeof loginSchema>;

// =============================================================================
// 2. CONFIGURAÇÃO WI-FI
// =============================================================================

export const wifiConfigSchema = z.object({
  ssid: z
    .string()
    .min(1, 'SSID é obrigatório.')
    .max(32, 'SSID deve ter no máximo 32 caracteres.')
    .regex(SSID_REGEX, 'SSID contém caracteres inválidos.'),
  password: z
    .string()
    .min(8, 'Senha Wi-Fi deve ter no mínimo 8 caracteres.')
    .max(63, 'Senha Wi-Fi deve ter no máximo 63 caracteres.')
    .regex(WIFI_PASSWORD_REGEX, 'Senha Wi-Fi contém caracteres inválidos.'),
  securityMode: z.enum(['None', 'WPA2', 'WPA2-WPA3']),
  enable: z.boolean(),
  band: z.enum(['2.4GHz', '5GHz']),
  guestId: z.number().int().min(0).max(7).optional(),
});

export type WifiConfigInput = z.infer<typeof wifiConfigSchema>;

// =============================================================================
// 3. CONFIGURAÇÃO DE RÁDIO
// =============================================================================

export const radioConfigSchema = z.object({
  enable2g: z.boolean(),
  channel2g: z.union([z.literal(''), z.string().regex(/^(Auto|[0-9]{1,3})$/, 'Canal inválido')]),
  bandwidth2g: z.enum(['20', '40', '80', '160', '']),
  power2g: z.union([
    z.literal(''),
    z.string().regex(/^[0-9]+$/, 'Potência deve ser um número.'),
  ]),
  enable5g: z.boolean(),
  channel5g: z.union([z.literal(''), z.string().regex(/^(Auto|[0-9]{1,3})$/, 'Canal inválido')]),
  bandwidth5g: z.enum(['20', '40', '80', '160', '']),
  power5g: z.union([
    z.literal(''),
    z.string().regex(/^[0-9]+$/, 'Potência deve ser um número.'),
  ]),
});

export type RadioConfigInput = z.infer<typeof radioConfigSchema>;

// =============================================================================
// 4. SERIAL NUMBER (usado em navegação, busca, etc.)
// =============================================================================

export const serialNumberSchema = z
  .string()
  .min(1, 'Número de série é obrigatório.')
  .max(SERIAL_MAX_LENGTH, `Número de série deve ter no máximo ${SERIAL_MAX_LENGTH} caracteres.`)
  .regex(SERIAL_REGEX, 'Número de série contém caracteres inválidos.');

// =============================================================================
// 5. PARÂMETRO TR-069 / TR-181
// =============================================================================

export const parameterSchema = z.object({
  name: z.string().min(1).max(512),
  value: z.string().max(4096),
  type: z.enum(['xsd:string', 'xsd:boolean', 'xsd:int', 'xsd:unsignedInt', 'xsd:dateTime']).optional(),
});

export const configPayloadSchema = z.object({
  parameters: z.array(parameterSchema).min(1, 'Pelo menos um parâmetro deve ser enviado.'),
});

export type ConfigPayloadInput = z.infer<typeof configPayloadSchema>;

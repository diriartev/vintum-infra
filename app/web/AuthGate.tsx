import { FormEvent, useState } from 'react'
import { name as appName, privacyPolicyLink, slogan, termsAndConditionsLink } from 'src/config'
import { useAuth } from 'src/features/auth'
import { axios } from 'src/lib/axios'
import './authGate.css'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong email or password',
  email_taken: 'That email already has an account -- try logging in instead',
  password_too_weak: "Password shouldn't contain your email",
  too_many_attempts: 'Too many attempts, please wait a few minutes and try again',
  invalid_input: 'Please check the fields and try again',
  invalid_code: 'Wrong code. Check the email and try again',
  code_expired: 'That code expired or is no longer valid -- start again',
  too_many_resends: 'Too many codes requested -- start again',
  resend_too_soon: 'Please wait a minute before asking for a new code',
  invalid_token: 'This reset link is invalid, expired or was already used -- ask for a new one',
  mail_unavailable: 'Password recovery is temporarily unavailable, please try again later',
  default: 'Something went wrong, please try again',
}

// Marca de Vintum como SVG inline (no como <img>) para que quede nítida en
// cualquier tamaño/densidad de pantalla y pueda animarse con CSS.
const VintumMark = () => (
  <svg className="AuthGateMark" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="15" fill="#0d1117" />
    <path d="M 12 13 L 22 13 L 32 42 L 42 13 L 52 13 L 38 51 L 26 51 Z" fill="#f5f7fa" />
    <circle className="AuthGateMarkDot" cx="48" cy="15" r="5.5" fill="#0366d6" />
  </svg>
)

// Pantalla completa que reemplaza a toda la app cuando no hay sesión --
// Vintum no se puede usar como invitado, hay que crear cuenta o loguearse
// primero (a diferencia del hackertab.dev original, que es de uso anónimo).
type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'otp'

const SUBMIT_LABELS: Record<Mode, string> = {
  login: 'Log in',
  register: 'Create account',
  forgot: 'Send reset link',
  reset: 'Change password',
  otp: 'Verify',
}

// El enlace del correo de recuperación trae el token en el fragmento:
// https://web.vintum.example/#/reset-password?token=<64 hex>
const readResetToken = (): string | null => {
  const m = window.location.hash.match(/^#\/reset-password\?token=([0-9a-f]{64})$/)
  return m ? m[1] : null
}

const TITLES: Record<Mode, [string, string]> = {
  login: ['Log in to your account', 'Log in to see the topics and sources you follow.'],
  register: [
    'Create your account',
    'Vintum accounts are free -- pick your topics and sync them across devices.',
  ],
  forgot: ['Forgot your password?', "Enter your account's email and we'll send you a reset link."],
  reset: ['Choose a new password', 'At least 10 characters. You will be logged out everywhere else.'],
  otp: ['Enter the code', ''],
}

export const AuthGate = () => {
  const { login, register, verifyOtp, resendOtp } = useAuth()
  const [resetToken] = useState(readResetToken)
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const pending = login.isLoading || register.isLoading || verifyOtp.isLoading || sending

  const goTo = (next: Mode) => {
    setError(null)
    setNotice(null)
    setPassword('')
    setPassword2('')
    setMode(next)
  }

  const apiError = (err: any) => {
    const errCode = err?.response?.data?.error
    const remaining = err?.response?.data?.remaining
    let msg = ERROR_MESSAGES[errCode] ?? ERROR_MESSAGES.default
    if (errCode === 'invalid_code' && typeof remaining === 'number' && remaining > 0) {
      msg += ` (${remaining} ${remaining === 1 ? 'try' : 'tries'} left)`
    }
    setError(msg)
    if (mode === 'otp' && errCode && errCode !== 'invalid_code') setMode('login')
  }

  const onVerify = () => {
    setError(null)
    verifyOtp.mutate({ code }, { onError: apiError })
  }

  const onResend = async () => {
    setError(null)
    setNotice(null)
    try {
      await resendOtp()
      setNotice('New code sent. Check your inbox (and spam).')
    } catch (err) {
      apiError(err)
    }
  }

  const onRecovery = async () => {
    setSending(true)
    try {
      if (mode === 'forgot') {
        await axios.post('/auth/forgot', { email })
        setNotice(
          'If an account exists for that email, a reset link is on its way. Check your inbox (and spam).'
        )
      } else {
        if (password !== password2) {
          setError("Passwords don't match")
          return
        }
        await axios.post('/auth/reset', { token: resetToken, password })
        // Quita el token de la barra de direcciones/historial.
        window.history.replaceState(null, '', window.location.pathname + '#/')
        goTo('login')
        setNotice('Password changed. Log in with your new password.')
      }
    } catch (err) {
      apiError(err)
    } finally {
      setSending(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'forgot' || mode === 'reset') {
      void onRecovery()
      return
    }
    if (mode === 'otp') {
      onVerify()
      return
    }
    setNotice(null)
    const mutation = mode === 'login' ? login : register
    const payload = mode === 'login' ? { email, password } : { email, password, displayName }
    // @ts-expect-error -- union del payload según el modo
    mutation.mutate(payload, {
      onSuccess: (data: { email: string }) => {
        setMaskedEmail(data.email)
        setCode('')
        setError(null)
        setNotice(null)
        setMode('otp')
      },
      onError: apiError,
    })
  }

  const switchMode = () => goTo(mode === 'register' ? 'login' : mode === 'login' ? 'register' : 'login')

  return (
    <div className="AuthGate">
      <div className="AuthGateGlow AuthGateGlowOne" aria-hidden="true" />
      <div className="AuthGateGlow AuthGateGlowTwo" aria-hidden="true" />

      <div className="AuthGateCard">
        <VintumMark />
        <h1 className="AuthGateBrand" aria-label={appName}>
          Vintum
        </h1>
        <p className="AuthGateSlogan">{slogan}</p>

        {/* la key fuerza a React a remontar el bloque cuando cambia el modo,
            así el CSS de entrada se vuelve a disparar (cross-fade). */}
        <div className="AuthGateFormWrap" key={mode}>
          <h2>{TITLES[mode][0]}</h2>
          <p className="AuthGateDescription">
            {mode === 'otp'
              ? `We sent a 6-digit code to ${maskedEmail}. It expires in 10 minutes.`
              : TITLES[mode][1]}
          </p>
          <form onSubmit={onSubmit} className="AuthGateForm">
            {mode === 'otp' && (
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                required
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ textAlign: 'center', letterSpacing: '6px', fontSize: '1.1em' }}
              />
            )}
            {mode === 'register' && (
              <input
                type="text"
                placeholder="Name"
                required
                minLength={1}
                maxLength={80}
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
            {mode !== 'reset' && mode !== 'otp' && (
              <input
                type="email"
                placeholder="Email"
                required
                maxLength={255}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            {mode !== 'forgot' && mode !== 'otp' && (
              <input
                type="password"
                placeholder={mode === 'reset' ? 'New password (min 10 characters)' : 'Password (min 10 characters)'}
                required
                minLength={10}
                maxLength={256}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            {mode === 'reset' && (
              <input
                type="password"
                placeholder="Repeat the new password"
                required
                minLength={10}
                maxLength={256}
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            )}
            <button type="submit" className="AuthGateSubmit" disabled={pending}>
              <span>{pending ? 'Please wait…' : SUBMIT_LABELS[mode]}</span>
            </button>
          </form>
          {mode === 'login' && (
            <button type="button" className="AuthGateSwitch AuthGateForgot" onClick={() => goTo('forgot')}>
              Forgot your password?
            </button>
          )}
          {mode === 'otp' ? (
            <>
              <button type="button" className="AuthGateSwitch AuthGateForgot" onClick={onResend}>
                Didn't get it? Resend code
              </button>
              <button type="button" className="AuthGateSwitch" onClick={() => goTo('login')}>
                Back to log in
              </button>
            </>
          ) : (
            <button type="button" className="AuthGateSwitch" onClick={switchMode}>
              {mode === 'login'
                ? "Don't have an account? Sign up"
                : mode === 'register'
                  ? 'Already have an account? Log in'
                  : 'Back to log in'}
            </button>
          )}
          {notice && <div className="AuthGateNotice">{notice}</div>}
          {error && <div className="AuthGateError">{error}</div>}
        </div>

        <p className="AuthGateFooter">
          By continuing, you agree to our{' '}
          <a href={termsAndConditionsLink} target="_blank" rel="noreferrer">
            terms of service
          </a>{' '}
          and{' '}
          <a href={privacyPolicyLink} target="_blank" rel="noreferrer">
            privacy policy
          </a>
          .
        </p>
      </div>
    </div>
  )
}

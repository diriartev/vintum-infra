import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { AuthModalStore, AuthStatusStore, AuthStore } from 'src/features/auth'
import { User } from 'src/features/auth/types'
import { trackUserDisconnect } from 'src/lib/analytics'
import { axios } from 'src/lib/axios'

type Credentials = { email: string; password: string }
type RegisterPayload = Credentials & { displayName: string }

type AuthResponse = { csrfToken: string; displayName: string; imageURL: string | null; email?: string }
// Login y registro ya no dan sesión: piden el código enviado al correo.
export type OtpPending = { otpRequired: true; email: string }

function toUser(email: string, data: AuthResponse): User {
  return {
    id: email,
    name: data.displayName,
    email,
    imageURL: data.imageURL ?? undefined,
    connectedAt: new Date().toISOString(),
  }
}

export const useAuth = () => {
  const authModalStore = AuthModalStore()
  const authStore = AuthStore()
  const authStatusStore = AuthStatusStore()

  const isConnected = authStore.user != null

  const shouldIcrementStreak = useCallback(() => {
    if (!isConnected) return false
    const last = authStore.lastStreakUpdate
    if (!last) return true
    const today = new Date().toISOString()
    const lastDay = new Date(last).toISOString()
    return today !== lastDay
  }, [isConnected, authStore.lastStreakUpdate])

  // El ResponseInterceptor global (src/lib/interceptors/ResponseInterceptor.ts)
  // ya devuelve response.data directo -- axios acá resuelve con el body ya
  // parseado, no con un AxiosResponse envolvente.
  const login = useMutation({
    mutationFn: ({ email, password }: Credentials): Promise<OtpPending> =>
      axios.post('/auth/login', { email, password }),
  })

  const register = useMutation({
    mutationFn: ({ email, password, displayName }: RegisterPayload): Promise<OtpPending> =>
      axios.post('/auth/register', { email, password, displayName }),
  })

  // Segundo factor: el único paso que abre sesión.
  const verifyOtp = useMutation({
    mutationFn: ({ code }: { code: string }): Promise<AuthResponse> =>
      axios.post('/auth/verify', { code }),
    onSuccess: (data) => {
      authStore.initState({ user: toUser(data.email ?? '', data), csrfToken: data.csrfToken })
      authModalStore.closeAuthModal()
    },
  })

  const resendOtp = (): Promise<{ ok: boolean }> => axios.post('/auth/resend')

  const logout = useCallback(async () => {
    trackUserDisconnect()
    try {
      await axios.post('/auth/logout')
    } finally {
      authStore.clear()
    }
  }, [authStore])

  return {
    ...authModalStore,
    ...authStore,
    ...authStatusStore,
    isConnected,
    shouldIcrementStreak,
    login,
    register,
    verifyOtp,
    resendOtp,
    logout,
  }
}

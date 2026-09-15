import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // localhost 가 IPv6(::1)에만 묶이면 127.0.0.1 주소로 열리지 않는다. IPv4 로 고정한다.
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:8010' },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})

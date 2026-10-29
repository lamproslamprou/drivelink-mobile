import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vendor libraries get their own chunks so the app code is small, downloads in
// parallel, and the big libraries stay cached across deploys.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'vendor-charts'
          if (id.includes('leaflet')) return 'vendor-map'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('react')) return 'vendor-react'
        },
      },
    },
  },
})

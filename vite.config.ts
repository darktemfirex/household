import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : GitHub Pages 저장소 경로(/repo-name/)와 무관하게 동작
export default defineConfig({ base: './', plugins: [react()] });

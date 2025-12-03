// src/main.js
import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// === 新增部分开始 ===
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
// === 新增部分结束 ===

const app = createApp(App)

app.use(ElementPlus) // 注册组件库
app.mount('#app')
<template>
  <div class="common-layout">
    <el-container style="height: 100vh; background-color: #f5f7fa;">

      <el-aside width="220px" class="app-sidebar">
        <div class="logo-area">
          <img src="/vite.svg" alt="Logo" class="logo-icon" />
          <span class="app-title">AI 电商工作台</span>
        </div>

        <el-menu :default-active="activeMenu" class="el-menu-vertical" background-color="#001529" text-color="#a6adb4"
          active-text-color="#fff" @select="handleMenuSelect">
          <el-menu-item index="image">
            <el-icon>
              <Picture />
            </el-icon>
            <span>图生图 (营销图)</span>
          </el-menu-item>

          <el-menu-item index="video">
            <el-icon>
              <VideoCamera />
            </el-icon>
            <span>图生视频 (短视频)</span>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-container>
        <AppHeader :title="pageTitle" :subtitle="pageSubtitle" />

        <el-main class="app-main-area">
          <keep-alive>
            <component :is="currentComponent" />
          </keep-alive>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Picture, VideoCamera } from '@element-plus/icons-vue'
import AppHeader from './components/AppHeader.vue'
import ImageGenerator from './components/ImageGenerator.vue'
import VideoGenerator from './components/VideoGenerator.vue'

const activeMenu = ref('image')

const handleMenuSelect = (index) => {
  activeMenu.value = index
}

const currentComponent = computed(() => {
  return activeMenu.value === 'image' ? ImageGenerator : VideoGenerator
})

const pageTitle = computed(() => activeMenu.value === 'image' ? '商品营销图生成' : '电商短视频生成')
const pageSubtitle = computed(() => activeMenu.value === 'image' ? 'Qwen-VL 识图 + 万相背景生成' : 'Qwen-Max 创意脚本 + Kling 视频生成')
</script>

<style>
/* 全局重置 */
body {
  margin: 0;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
}

/* 侧边栏 */
.app-sidebar {
  background-color: #001529;
  color: white;
  display: flex;
  flex-direction: column;
}

.logo-area {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #001529;
  border-bottom: 1px solid #001529;
}

.logo-icon {
  height: 24px;
  margin-right: 10px;
}

.app-title {
  font-weight: bold;
  font-size: 16px;
}

.el-menu-vertical {
  border-right: none !important;
}

/* 主区域调整 */
.app-main-area {
  padding: 24px;
  /* 移除这里的 background-color，改用透明 */
  background-color: transparent;
  margin-top: 60px;
  /* 头部高度 */
}
</style>
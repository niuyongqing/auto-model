<template>
  <div class="app-container">
    <el-container class="main-container">
      <el-header class="app-header">
        <div class="header-inner">
          <div class="logo">
            <span class="logo-icon">🚀</span>
            <span class="logo-text">AI 资产生成器</span>
          </div>
          </div>
      </el-header>

      <el-main>
        <div class="content-wrapper">
          <el-card class="form-card" shadow="always">
            <template #header>
              <div class="card-header">
                <span class="step-badge">Step 1</span>
                <span class="header-title">配置商品信息</span>
              </div>
            </template>

            <div class="form-layout">
              <el-row :gutter="40">
                <el-col :xs="24" :md="10">
                  <div class="input-section">
                    <label class="custom-label">商品名称</label>
                    <div class="sub-label">请输入英文或中文名称，AI 将根据名称优化提示词</div>
                    <el-input 
                      v-model="productName" 
                      placeholder="例如：Portable Ceramic Coffee Cup" 
                      size="large"
                      class="custom-input"
                      clearable
                    >
                      <template #prefix>
                        <el-icon><jb-icon /></el-icon> </template>
                    </el-input>

                    <div class="generate-btn-wrapper">
                      <el-button 
                        type="primary" 
                        size="large" 
                        :loading="loading" 
                        @click="startGenerate" 
                        class="generate-btn"
                        round
                      >
                        <el-icon class="el-icon--left" v-if="!loading"><MagicStick /></el-icon>
                        {{ loading ? '正在智能分析与生成...' : '立即生成营销方案' }}
                      </el-button>
                    </div>
                  </div>
                </el-col>

                <el-col :xs="24" :md="14">
                  <div class="upload-section">
                    <label class="custom-label">上传商品白底图</label>
                    <el-upload 
                      class="upload-demo custom-upload" 
                      drag 
                      action="" 
                      :auto-upload="false" 
                      :limit="1"
                      :on-change="handleFileChange" 
                      :file-list="fileList" 
                      list-type="picture"
                    >
                      <div class="upload-placeholder">
                        <el-icon class="el-icon--upload upload-icon"><upload-filled /></el-icon>
                        <div class="el-upload__text">
                          将图片拖到此处，或 <em>点击上传</em>
                        </div>
                        <div class="el-upload__tip">支持 JPG/PNG 文件，建议上传纯白底商品图</div>
                      </div>
                    </el-upload>
                  </div>
                </el-col>
              </el-row>
            </div>
          </el-card>

          <transition name="el-fade-in-linear">
            <div v-if="results.length > 0" class="result-area">
              <div class="section-divider">
                <span class="divider-text">✨ 生成结果 (已为您策划 3 组爆款方案) ✨</span>
              </div>

              <el-row :gutter="24">
                <el-col v-for="(item, index) in results" :key="index" :xs="24" :sm="12" :md="8">
                  <el-card :body-style="{ padding: '0px' }" shadow="hover" class="result-card">
                    <div class="image-wrapper">
                      <div class="style-tag">{{ item.style }}</div>
                      <el-image 
                        :src="item.imageUrl" 
                        fit="cover" 
                        class="result-image" 
                        loading="lazy"
                        :preview-src-list="[item.imageUrl]" 
                      />
                      <div class="image-overlay">
                        <el-button type="primary" circle @click="downloadImage(item.imageUrl, index)">
                          <el-icon><Download /></el-icon>
                        </el-button>
                      </div>
                    </div>

                    <div class="card-content">
                      <div class="title-group">
                        <div class="title-label">爆款标题推荐</div>
                        <el-tooltip content="点击复制标题" placement="top">
                          <div class="generated-title" @click="copyText(item.title)">
                            {{ item.title }}
                          </div>
                        </el-tooltip>
                      </div>
                      
                      <div class="card-footer">
                        <el-button text bg size="small" @click="copyText(item.title)" class="action-btn">
                          复制标题
                        </el-button>
                        <el-button type="primary" text bg size="small" @click="downloadImage(item.imageUrl, index)" class="action-btn">
                          下载图片
                        </el-button>
                      </div>
                    </div>
                  </el-card>
                </el-col>
              </el-row>
            </div>
          </transition>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { UploadFilled, MagicStick, Download } from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import axios from 'axios'

// === 保持原有逻辑不变 ===
const fileList = ref([])
const productName = ref('') 
const loading = ref(false)
const results = ref([])

const handleFileChange = (uploadFile, uploadFiles) => {
  if (uploadFiles.length > 1) uploadFiles.shift()
  fileList.value = uploadFiles
}

const startGenerate = async () => {
  if (fileList.value.length === 0) return ElMessage.warning('请上传图片！')
  if (!productName.value) return ElMessage.warning('请输入商品名称！')

  loading.value = true
  results.value = []

  try {
    const formData = new FormData()
    formData.append('file', fileList.value[0].raw)
    formData.append('productName', productName.value)

    const response = await axios.post('http://localhost:3333/api/generate', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })

    if (response.data.success) {
      results.value = response.data.data
      ElMessage.success('方案生成成功！')
    } else {
      ElMessage.error('失败: ' + response.data.error)
    }
  } catch (error) {
    ElMessage.error('请求出错')
    console.error(error)
  } finally {
    loading.value = false
  }
}

const copyText = (text) => {
  navigator.clipboard.writeText(text)
  ElMessage.success('标题已复制')
}

const downloadImage = (url, index) => {
  const a = document.createElement('a')
  a.href = url
  a.download = `SKU_Variant_${index + 1}.png`
  a.target = '_blank'
  a.click()
}
</script>

<style scoped>
/* 全局容器 */
.app-container {
  background-color: #f5f7fa;
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.main-container {
  display: flex;
  flex-direction: column;
}

/* 顶部导航优化 */
.app-header {
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  padding: 0;
  z-index: 100;
  position: sticky;
  top: 0;
}

.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.logo {
  font-size: 20px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.logo-text {
  background: linear-gradient(90deg, #409eff, #36cfc9);
  -webkit-background-clip: text;
  color: transparent;
  letter-spacing: -0.5px;
}

/* 主内容区 */
.content-wrapper {
  margin: 20px auto;
  padding: 0 20px;
}

/* 表单卡片 */
.form-card {
  border: none;
  border-radius: 12px;
  overflow: visible; /* 允许阴影溢出 */
  margin-bottom: 40px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 0;
}

.step-badge {
  background: #e6f7ff;
  color: #1890ff;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: bold;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

/* 表单布局 */
.form-layout {
  padding: 10px 0;
}

.custom-label {
  display: block;
  font-weight: 600;
  color: #374151;
  margin-bottom: 6px;
  font-size: 14px;
}

.sub-label {
  font-size: 12px;
  color: #9ca3af;
  margin-bottom: 12px;
}

.input-section {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.generate-btn-wrapper {
  margin-top: 30px;
}

.generate-btn {
  width: 100%;
  background: linear-gradient(135deg, #409eff 0%, #096dd9 100%);
  border: none;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(64, 158, 255, 0.3);
  transition: all 0.3s ease;
}

.generate-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(64, 158, 255, 0.4);
}

/* 上传区域优化 */
.upload-section {
  height: 100%;
}

:deep(.custom-upload .el-upload-dragger) {
  border: 2px dashed #e5e7eb;
  border-radius: 12px;
  background: #f9fafb;
  transition: all 0.3s;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.custom-upload .el-upload-dragger:hover) {
  border-color: #409eff;
  background: #f0f9ff;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #6b7280;
}

.upload-icon {
  font-size: 48px;
  color: #9ca3af;
  margin-bottom: 16px;
  transition: color 0.3s;
}

:deep(.el-upload-dragger:hover .upload-icon) {
  color: #409eff;
}

/* 结果区域 */
.section-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 40px 0 30px;
}

.divider-text {
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  background: #f5f7fa;
  padding: 0 20px;
}

.result-card {
  border: none;
  border-radius: 12px;
  transition: all 0.3s ease;
  margin-bottom: 24px;
  overflow: hidden;
}

.result-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
}

.image-wrapper {
  position: relative;
  overflow: hidden;
  height: 260px;
}

.result-image {
  width: 100%;
  height: 100%;
  transition: transform 0.5s ease;
}

.result-card:hover .result-image {
  transform: scale(1.05);
}

.style-tag {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  color: #fff;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  z-index: 2;
  font-weight: 500;
}

.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s;
  z-index: 3;
}

.image-wrapper:hover .image-overlay {
  opacity: 1;
}

.card-content {
  padding: 20px;
}

.title-label {
  font-size: 12px;
  text-transform: uppercase;
  color: #9ca3af;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.generated-title {
  font-size: 14px;
  line-height: 1.5;
  color: #1f2937;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  height: 42px;
  cursor: pointer;
  transition: color 0.2s;
}

.generated-title:hover {
  color: #409eff;
}

.card-footer {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f3f4f6;
  display: flex;
  justify-content: space-between;
}

.action-btn {
  font-weight: 600;
}
</style>
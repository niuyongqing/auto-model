<template>
  <div class="common-layout">
    <el-container>
      <el-header class="header">
        <div class="logo">🚀 AI 广铺资产生成器</div>
      </el-header>

      <el-main class="main-content">
        <el-card class="upload-card">
          <template #header>
            <div class="card-header">
              <span>第一步：输入商品信息</span>
            </div>
          </template>

          <el-form label-position="top">
            <el-form-item label="商品名称 (英文/中文)">
              <el-input v-model="productName" placeholder="例如：Portable Ceramic Coffee Cup" size="large" />
            </el-form-item>

            <el-form-item label="商品白底图">
              <el-upload class="upload-demo" drag action="" :auto-upload="false" :limit="1"
                :on-change="handleFileChange" :file-list="fileList" list-type="picture">
                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                <div class="el-upload__text">拖拽图片到这里</div>
              </el-upload>
            </el-form-item>
          </el-form>

          <div class="action-area">
            <el-button type="primary" size="large" :loading="loading" @click="startGenerate" round
              style="width: 200px;">
              <el-icon class="el-icon--left">
                <MagicStick />
              </el-icon>
              {{ loading ? '正在生成多组Listing...' : '生成广铺方案' }}
            </el-button>
          </div>
        </el-card>

        <div v-if="results.length > 0" class="result-area">
          <el-divider content-position="left">生成结果 (已为您策划 3 组爆款方案)</el-divider>

          <el-row :gutter="20">
            <el-col v-for="(item, index) in results" :key="index" :span="8" :xs="24">
              <el-card :body-style="{ padding: '0px' }" shadow="hover" class="listing-card">
                <div class="style-tag">{{ item.style }}</div>

                <el-image :src="item.imageUrl" fit="cover" class="result-image" />

                <div class="card-content">
                  <div class="title-label">爆款标题:</div>
                  <div class="generated-title">{{ item.title }}</div>

                  <div class="button-group">
                    <el-button size="small" @click="copyText(item.title)">复制标题</el-button>
                    <el-button type="primary" size="small" @click="downloadImage(item.imageUrl, index)">下载图片</el-button>
                  </div>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { UploadFilled, MagicStick } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const fileList = ref([])
const productName = ref('') // 绑定商品名
const loading = ref(false)
const results = ref([])     // 存储完整结果对象

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
    // 传商品名给后端
    formData.append('productName', productName.value)

    // 注意：这里改成你的局域网 IP 或者 localhost
    const response = await axios.post('http://localhost:3000/api/generate', formData, {
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
.header {
  background: #1f2937;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-weight: bold;
}

.main-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.upload-card {
  margin-bottom: 30px;
  text-align: center;
}

.action-area {
  margin-top: 20px;
}

/* 卡片样式优化 */
.listing-card {
  position: relative;
  overflow: hidden;
}

.style-tag {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 2;
}

.result-image {
  width: 100%;
  height: 250px;
  display: block;
}

.card-content {
  padding: 15px;
  text-align: left;
}

.title-label {
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}

.generated-title {
  font-weight: bold;
  color: #333;
  margin-bottom: 15px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  height: 60px;
  font-size: 14px;
}

.button-group {
  display: flex;
  justify-content: space-between;
}
</style>
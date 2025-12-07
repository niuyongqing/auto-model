<template>
    <div class="view-wrapper">
        <el-row :gutter="24" style="height: 100%;">

            <el-col :span="10" style="height: 100%;">
                <el-card shadow="never" class="control-card">
                    <template #header>
                        <div class="card-header">
                            <span class="header-icon">⚙️</span>
                            <span>配置与上传</span>
                        </div>
                    </template>

                    <el-form label-position="top" class="custom-form">
                        <el-form-item label="商品名称">
                            <el-input v-model="productName" placeholder="例如：夏季透气运动鞋" size="large"
                                class="custom-input" />
                        </el-form-item>

                        <el-form-item label="参考原图">
                            <el-upload v-if="!previewUrl" class="upload-area" drag action="#" :auto-upload="false"
                                :on-change="handleFileChange" :limit="1" :show-file-list="false" accept="image/*">
                                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                                <div class="el-upload__text">
                                    点击或拖拽上传
                                    <div class="upload-tip">支持 JPG/PNG/WebP</div>
                                </div>
                            </el-upload>

                            <div v-else class="preview-box">
                                <el-image :src="previewUrl" fit="cover" class="uploaded-image" />
                                <div class="preview-actions">
                                    <el-button type="danger" circle :icon="Delete" @click="removeFile"
                                        title="删除并重新上传" />
                                </div>
                            </div>
                        </el-form-item>

                        <div class="action-area">
                            <el-button type="primary" size="large" class="generate-btn" :loading="analyzing"
                                @click="startGeneration" round>
                                <el-icon style="margin-right: 8px">
                                    <MagicStick />
                                </el-icon>
                                {{ analyzing ? 'AI 正在分析设计中...' : '开始智能生图' }}
                            </el-button>
                        </div>
                    </el-form>
                </el-card>
            </el-col>

            <el-col :span="14" style="height: 100%;">
                <el-card shadow="never" class="result-card">
                    <template #header>
                        <div class="card-header">
                            <span class="header-icon">🎨</span>
                            <span>生成结果</span>
                            <el-tag v-if="results.length" type="success" effect="dark" round>完成</el-tag>
                        </div>
                    </template>

                    <div v-if="results.length === 0" class="empty-state">
                        <el-empty :image-size="200" description="暂无设计方案，请在左侧上传商品图" />
                    </div>

                    <div v-else class="results-grid">
                        <div v-for="(item, index) in results" :key="index" class="result-item">
                            <div class="image-wrapper">
                                <el-image :src="item.imageUrl" :preview-src-list="results.map(r => r.imageUrl)"
                                    fit="cover" loading="lazy" class="custom-image" />
                                <div class="image-overlay">
                                    <el-button type="primary" circle :icon="Download"
                                        @click="downloadImage(item.imageUrl)" />
                                </div>
                                <div class="style-badge">{{ item.style }}</div>
                            </div>
                            <div class="info-content">
                                <h4 class="info-title">{{ item.title }}</h4>
                                <p class="info-prompt">{{ item.image_prompt }}</p>
                            </div>
                        </div>
                    </div>
                </el-card>
            </el-col>
        </el-row>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { UploadFilled, MagicStick, Download, Delete } from '@element-plus/icons-vue' // 引入 Delete 图标

const productName = ref('')
const fileList = ref([])
const previewUrl = ref('') // 用于存储本地预览地址
const analyzing = ref(false)
const results = ref([])

// 处理文件选择
const handleFileChange = (file) => {
    fileList.value = [file]
    // 生成本地预览 URL，实现“秒开”体验
    previewUrl.value = URL.createObjectURL(file.raw)
}

// 删除文件
const removeFile = () => {
    fileList.value = []
    previewUrl.value = ''
}

const downloadImage = (url) => {
    window.open(url, '_blank')
}

const startGeneration = async () => {
    if (fileList.value.length === 0) return ElMessage.warning('请先上传一张商品原图')

    analyzing.value = true
    results.value = []

    try {
        const formData = new FormData()
        formData.append('file', fileList.value[0].raw)
        formData.append('productName', productName.value || '商品')

        const res = await axios.post('http://localhost:3333/api/image/generate', formData)
        results.value = res.data
        ElMessage.success('设计方案已生成！')
    } catch (error) {
        console.error(error)
        ElMessage.error(error.response?.data?.message || '生成失败')
    } finally {
        analyzing.value = false
    }
}
</script>

<style scoped>
.view-wrapper {
    height: 100%;
}

/* === 卡片通用样式 === */
.control-card,
.result-card {
    border-radius: 16px;
    border: none;
    height: 100%;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
    background-color: #fff;
    transition: all 0.3s;
}

:deep(.el-card__body) {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
}

.card-header {
    font-weight: 700;
    font-size: 16px;
    color: #1f2d3d;
    display: flex;
    align-items: center;
    gap: 8px;
}

.header-icon {
    font-size: 18px;
}

/* === 上传区域样式 === */
.custom-form .el-form-item__label {
    font-weight: 600;
    color: #303133;
}

.upload-area :deep(.el-upload-dragger) {
    width: 200px;
    border-radius: 12px;
    border: 2px dashed #dcdfe6;
    background-color: #fcfcfc;
    transition: all 0.3s;
    height: 180px;
    /* 固定高度，防止跳动 */
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.upload-area :deep(.el-upload-dragger:hover) {
    border-color: #409EFF;
    background-color: #ecf5ff;
}

.upload-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 8px;
}

/* === 预览区域样式 (替换上传框) === */
.preview-box {
    width: 200px;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
    border: 1px solid #dcdfe6;
}

.uploaded-image {
    width: 100%;
    display: block;
}

/* 悬浮遮罩 */
.preview-actions {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    align-items: center;
    opacity: 0;
    transition: opacity 0.3s;
}

.preview-box:hover .preview-actions {
    opacity: 1;
}

/* === 按钮与结果列表样式 (保持原样) === */
.action-area {
    margin-top: 30px;
}

.generate-btn {
    width: 100%;
    font-weight: bold;
    height: 48px;
    font-size: 16px;
    background: linear-gradient(135deg, #409EFF 0%, #3a8ee6 100%);
    box-shadow: 0 4px 14px rgba(64, 158, 255, 0.3);
    border: none;
}

.generate-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(64, 158, 255, 0.4);
}

.results-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 20px;
}

.result-item {
    border-radius: 12px;
    overflow: hidden;
    background: linear-gradient(145deg, #ffffff, #f9fafc);
    border: 1px solid #ebedf0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
}

.result-item:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
    border-color: #c6e2ff;
}

.image-wrapper {
    position: relative;
    height: 220px;
    overflow: hidden;
}

.custom-image {
    width: 100%;
    height: 100%;
    transition: transform 0.5s;
}

.result-item:hover .custom-image {
    transform: scale(1.05);
}

.image-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(2px);
    opacity: 0;
    transition: opacity 0.3s;
    display: flex;
    justify-content: center;
    align-items: center;
}

.image-wrapper:hover .image-overlay {
    opacity: 1;
}

.style-badge {
    position: absolute;
    top: 12px;
    left: 12px;
    background: rgba(255, 255, 255, 0.95);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #303133;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.info-content {
    padding: 16px;
    text-align: left;
    background-color: transparent;
}

.info-title {
    margin: 0 0 8px 0;
    font-size: 16px;
    font-weight: 700;
    color: #1f2d3d;
}

.info-prompt {
    margin: 0;
    font-size: 13px;
    color: #606266;
    line-height: 1.6;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
}

.empty-state {
    padding: 60px 0;
    text-align: center;
}
</style>
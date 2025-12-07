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
                            <el-input v-model="productName" placeholder="例如：高级复古法压壶" size="large"
                                class="custom-input" />
                        </el-form-item>

                        <el-form-item label="参考首帧图">
                            <el-upload v-if="!previewUrl" class="upload-area" drag action="#" :auto-upload="false"
                                :on-change="handleFileChange" :limit="1" :show-file-list="false" accept="image/*">
                                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                                <div class="el-upload__text">
                                    点击或拖拽上传
                                    <div class="upload-tip">将作为视频的第一帧画面</div>
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
                            <el-button type="success" size="large" class="generate-btn video-btn" :loading="analyzing"
                                @click="analyzeVideoScript" round>
                                <el-icon style="margin-right: 8px">
                                    <VideoCamera />
                                </el-icon>
                                {{ analyzing ? 'AI 正在构思分镜...' : '第一步：生成创意脚本' }}
                            </el-button>
                        </div>
                    </el-form>
                </el-card>
            </el-col>

            <el-col :span="14" style="height: 100%;">
                <el-card shadow="never" class="result-card" v-loading="generating"
                    element-loading-text="视频渲染中，这可能需要 3-5 分钟...">
                    <template #header>
                        <div class="card-header">
                            <span class="header-icon">🎥</span>
                            <span>生成结果</span>
                            <el-tag v-if="prompts.length" type="success" effect="dark" round>完成</el-tag>
                        </div>
                    </template>

                    <div v-if="prompts.length > 0 && !finalVideoUrl" class="script-selection">
                        <p class="section-tip">✨ AI 为您策划了 3 组分镜，请选择一组进行拍摄：</p>
                        <div class="script-grid">
                            <div v-for="(item, index) in prompts" :key="index" class="script-card"
                                :class="{ active: selectedScriptIdx === index }" @click="selectedScriptIdx = index">
                                <div class="script-header">
                                    <span class="script-style-tag">{{ item.style }}</span>
                                    <el-icon v-if="selectedScriptIdx === index" color="#409EFF"><Select /></el-icon>
                                </div>
                                <div class="script-desc">{{ item.description }}</div>
                            </div>
                        </div>

                        <div class="action-footer" v-if="selectedScriptIdx !== -1">
                            <el-button type="primary" size="large" class="confirm-btn" round
                                @click="startKlingGeneration">
                                🎬 确认制作 (消耗点数)
                            </el-button>
                        </div>
                    </div>

                    <div v-else-if="finalVideoUrl" class="video-result">
                        <div class="video-container">
                            <video :src="finalVideoUrl" controls autoplay loop class="result-video"></video>
                        </div>
                        <div class="video-actions">
                            <el-button type="primary" size="large" :icon="Download" @click="downloadVideo"
                                round>下载视频</el-button>
                            <el-button size="large" @click="resetVideo" round>制作下一个</el-button>
                        </div>
                    </div>

                    <div v-else class="empty-state">
                        <el-empty :image-size="200" description="请先在左侧上传图片并生成脚本" />
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
import { VideoCamera, UploadFilled, Download, Delete, Select } from '@element-plus/icons-vue'

const productName = ref('')
const fileList = ref([])
const previewUrl = ref('') // 新增：用于本地预览
const analyzing = ref(false)
const generating = ref(false)
const prompts = ref([])
const selectedScriptIdx = ref(-1)
const currentImageUrl = ref('')
const finalVideoUrl = ref('')

// 处理文件选择 (参考 ImageGenerator)
const handleFileChange = (file) => {
    fileList.value = [file]
    previewUrl.value = URL.createObjectURL(file.raw) // 生成本地预览URL
}

// 删除文件
const removeFile = () => {
    fileList.value = []
    previewUrl.value = ''
    // 重置相关状态
    prompts.value = []
    selectedScriptIdx.value = -1
    finalVideoUrl.value = ''
}

const downloadVideo = () => {
    window.open(finalVideoUrl.value, '_blank')
}

// 1. 分析脚本
const analyzeVideoScript = async () => {
    if (fileList.value.length === 0) return ElMessage.warning('请先上传一张参考图片')

    analyzing.value = true
    prompts.value = []
    selectedScriptIdx.value = -1
    finalVideoUrl.value = ''

    try {
        const formData = new FormData()
        formData.append('file', fileList.value[0].raw)
        formData.append('productName', productName.value || '商品')

        const res = await axios.post('http://localhost:3333/api/video/analyze', formData)

        currentImageUrl.value = res.data.imageUrl
        prompts.value = res.data.prompts
        ElMessage.success('脚本已生成，请选择！')
    } catch (error) {
        console.error(error)
        ElMessage.error(error.response?.data?.message || '分析失败')
    } finally {
        analyzing.value = false
    }
}

// 2. 提交视频制作
const startKlingGeneration = async () => {
    if (selectedScriptIdx.value === -1) return

    const selectedPrompt = prompts.value[selectedScriptIdx.value]
    generating.value = true

    try {
        const res = await axios.post('http://localhost:3333/api/video/create', {
            imageUrl: currentImageUrl.value,
            prompt: selectedPrompt.english_prompt
        })

        const taskId = res.data.taskId
        ElMessage.info('任务已提交至云端渲染，请耐心等待...')
        pollVideoStatus(taskId)
    } catch (error) {
        ElMessage.error(error.response?.data?.message || '任务提交失败')
        generating.value = false
    }
}

// 3. 轮询
const pollVideoStatus = (taskId) => {
    const timer = setInterval(async () => {
        try {
            const res = await axios.get(`http://localhost:3333/api/video/status/${taskId}`)
            const { status, video_url, message } = res.data

            if (status === 'SUCCEEDED' || (res.data.data && res.data.data.status === 'SUCCEEDED')) {
                finalVideoUrl.value = video_url || res.data.data.video_url
                clearInterval(timer)
                generating.value = false
                ElMessage.success('视频制作完成！')
            } else if (status === 'FAILED') {
                clearInterval(timer)
                generating.value = false
                ElMessage.error(`制作失败: ${message}`)
            }
        } catch (e) {
            console.error('轮询出错', e)
        }
    }, 5000)
}

const resetVideo = () => {
    finalVideoUrl.value = ''
    selectedScriptIdx.value = -1
}
</script>

<style scoped>
.view-wrapper {
    height: 100%;
}

/* === 卡片通用样式 (复用 ImageGenerator) === */
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

/* === 表单与上传区域 (与 ImageGenerator 一致) === */
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

/* === 预览区域 (复用 ImageGenerator) === */
.preview-box {
    width: 200px;
    height: 180px;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
    border: 1px solid #dcdfe6;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #f8f9fa;
}

.uploaded-image {
    width: 100%;
    height: 100%;
    display: block;
}

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

/* === 按钮样式 === */
.action-area {
    margin-top: 30px;
}

.generate-btn {
    width: 100%;
    font-weight: bold;
    height: 48px;
    font-size: 16px;
    border: none;
    box-shadow: 0 4px 14px rgba(64, 158, 255, 0.3);
}

.video-btn {
    /* 视频按钮使用绿色/青色渐变，区分于图片的蓝色 */
    background: linear-gradient(135deg, #67c23a 0%, #529b2e 100%);
    box-shadow: 0 4px 14px rgba(103, 194, 58, 0.3);
}

.video-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(103, 194, 58, 0.4);
}

.confirm-btn {
    width: 200px;
    height: 44px;
    font-weight: 600;
    background: linear-gradient(135deg, #409EFF 0%, #3a8ee6 100%);
    box-shadow: 0 4px 14px rgba(64, 158, 255, 0.3);
    border: none;
}

.confirm-btn:hover {
    transform: translateY(-1px);
}

/* === 脚本选择区域 === */
.script-selection {
    padding: 10px;
}

.section-tip {
    font-size: 14px;
    color: #606266;
    margin-bottom: 20px;
    font-weight: 500;
}

.script-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.script-card {
    border: 1px solid #ebedf0;
    border-radius: 12px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.3s ease;
    background-color: #fff;
    position: relative;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
}

.script-card:hover {
    border-color: #c6e2ff;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.script-card.active {
    border-color: #409EFF;
    background-color: #ecf5ff;
    box-shadow: 0 0 0 1px #409EFF;
}

.script-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.script-style-tag {
    background-color: #f0f2f5;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    color: #606266;
}

.script-card.active .script-style-tag {
    background-color: #d9ecff;
    color: #409EFF;
}

.script-desc {
    font-size: 14px;
    color: #303133;
    line-height: 1.6;
}

.action-footer {
    margin-top: 30px;
    text-align: center;
}

/* === 视频结果区域 === */
.video-result {
    text-align: center;
    margin-top: 20px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.video-container {
    width: 100%;
    max-width: 600px;
    background: #000;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
    margin-bottom: 24px;
}

.result-video {
    width: 100%;
    display: block;
    max-height: 500px;
}

.video-actions {
    display: flex;
    justify-content: center;
    gap: 16px;
}

.empty-state {
    padding: 60px 0;
    text-align: center;
}
</style>
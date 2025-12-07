<template>
    <div class="view-wrapper">
        <el-row :gutter="20" style="height: 100%;">
            <el-col :span="10" style="height: 100%;">
                <el-card shadow="never" class="control-card">
                    <template #header>
                        <div class="card-header">
                            <span class="header-icon">⚙️</span>
                            <span>配置与上传</span>
                        </div>
                    </template>

                    <el-form label-position="top">
                        <el-form-item label="商品名称">
                            <el-input v-model="productName" placeholder="例如：高级复古法压壶" size="large" />
                        </el-form-item>

                        <el-form-item label="参考图片">
                            <el-upload class="upload-area small-upload" drag action="#" :auto-upload="false"
                                :on-change="handleFileChange" :on-remove="handleFileRemove" :limit="1"
                                :file-list="fileList">
                                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                                <div class="el-upload__text">上传一张图片作为视频首帧</div>
                            </el-upload>
                        </el-form-item>

                        <el-button type="success" size="large" class="full-width-btn" :loading="analyzing"
                            @click="analyzeVideoScript">
                            <el-icon style="margin-right: 8px">
                                <VideoCamera />
                            </el-icon>
                            {{ analyzing ? 'AI 正在构思分镜...' : '生成创意脚本' }}
                        </el-button>
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
                        <p class="section-tip">AI 为您策划了 3 组分镜，请选择一组进行拍摄：</p>
                        <div class="script-grid">
                            <div v-for="(item, index) in prompts" :key="index" class="script-card"
                                :class="{ active: selectedScriptIdx === index }" @click="selectedScriptIdx = index">
                                <div class="script-style">{{ item.style }}</div>
                                <div class="script-desc">{{ item.description }}</div>
                            </div>
                        </div>

                        <div class="action-footer" v-if="selectedScriptIdx !== -1">
                            <el-button type="primary" size="large" round @click="startKlingGeneration">
                                🎬 确认制作 (消耗点数)
                            </el-button>
                        </div>
                    </div>

                    <div v-else-if="finalVideoUrl" class="video-result">
                        <video :src="finalVideoUrl" controls autoplay loop class="result-video"></video>
                        <div class="video-actions">
                            <el-button type="primary" :icon="Download" @click="downloadVideo">下载视频</el-button>
                            <el-button @click="resetVideo">制作下一个</el-button>
                        </div>
                    </div>

                    <div v-else class="empty-state">
                        <el-empty description="请先在左侧生成创意脚本" />
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
import { VideoCamera, UploadFilled, Download } from '@element-plus/icons-vue'

const productName = ref('')
const fileList = ref([])
const analyzing = ref(false)
const generating = ref(false)
const prompts = ref([])
const selectedScriptIdx = ref(-1)
const currentImageUrl = ref('')
const finalVideoUrl = ref('')

const handleFileChange = (file) => {
    fileList.value = [file]
}
const handleFileRemove = () => {
    fileList.value = []
}
const downloadVideo = () => {
    window.open(finalVideoUrl.value, '_blank')
}

// 1. 分析脚本
const analyzeVideoScript = async () => {
    if (fileList.value.length === 0) return ElMessage.warning('请上传参考图片')

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
        ElMessage.error('分析失败')
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
        ElMessage.error('任务提交失败')
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

.control-card,
.result-card {
    border-radius: 8px;
    border: none;
    height: 100%;
    display: flex;
    flex-direction: column;
}

:deep(.el-card__body) {
    flex: 1;
    overflow-y: auto;
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

.full-width-btn {
    width: 100%;
    margin-top: 10px;
    font-weight: bold;
}

.script-grid {
    display: grid;
    grid-template-columns: repeat(1, 1fr);
    gap: 12px;
    margin-top: 15px;
}

.script-card {
    border: 1px solid #dcdfe6;
    border-radius: 6px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.2s;
    background-color: #fff;
}

.script-card:hover {
    border-color: #b3d8ff;
}

.script-card.active {
    border-color: #409EFF;
    background-color: #ecf5ff;
}

.script-style {
    font-weight: bold;
    color: #303133;
    font-size: 14px;
    margin-bottom: 4px;
}

.script-desc {
    font-size: 13px;
    color: #606266;
    line-height: 1.5;
}

.section-tip {
    font-size: 14px;
    color: #606266;
    margin-bottom: 10px;
}

.action-footer {
    margin-top: 20px;
    text-align: center;
}

.video-result {
    text-align: center;
    margin-top: 20px;
}

.result-video {
    width: 100%;
    max-width: 480px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    margin-bottom: 15px;
}

.video-actions {
    display: flex;
    justify-content: center;
    gap: 15px;
}

.empty-state {
    padding: 40px 0;
    text-align: center;
}
</style>
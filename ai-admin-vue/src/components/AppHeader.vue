<template>
    <el-header class="app-header">
        <div class="header-left">
            <h2 class="page-title">{{ title }}</h2>
            <span class="page-subtitle">{{ subtitle }}</span>
        </div>
        <div class="header-right">
            <slot name="right"></slot>
        </div>
    </el-header>
</template>

<script setup>
defineProps({
    title: {
        type: String,
        required: true,
        default: '标题'
    },
    subtitle: {
        type: String,
        default: ''
    }
})
</script>

<style scoped>
.app-header {
    background-color: #fff;
    border-bottom: 1px solid #e4e7ed;
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* 左右两端对齐 */
    padding: 0 24px;
    height: 60px;
    /* 固定高度 */
    width: 100%;
    position: absolute;
    z-index: 10;
}

.header-left {
    display: flex;
    align-items: center;
}

.page-title {
    margin: 0;
    font-size: 18px;
    color: #303133;
    font-weight: 600;
}

.page-subtitle {
    margin-left: 12px;
    font-size: 13px;
    color: #909399;
    padding-left: 12px;
    border-left: 1px solid #dcdfe6;
    /* 加个小竖线分隔更好看 */
    line-height: 14px;
}
</style>
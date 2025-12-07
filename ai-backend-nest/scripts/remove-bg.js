// scripts/remove-bg.js
const { removeBackground } = require('@imgly/background-removal-node');
const fs = require('fs');
const path = require('path');

// 从命令行参数获取输入输出路径
const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
    console.error('Usage: node remove-bg.js <inputPath> <outputPath>');
    process.exit(1);
}

(async () => {
    try {
        // console.log(`[Child] Processing: ${inputPath}`);

        // 核心：在独立进程中执行抠图
        // 直接传 file:// 协议的路径，库的支持最好
        const blob = await removeBackground(`file://${inputPath}`);
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 写入结果
        fs.writeFileSync(outputPath, buffer);

        // console.log(`[Child] Success -> ${outputPath}`);
        process.exit(0);
    } catch (error) {
        console.error(`[Child Error] ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
})();
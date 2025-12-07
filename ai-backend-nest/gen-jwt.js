// 文件名: gen-jwt.js
const jwt = require('jsonwebtoken');

// 🔴 1. 填入截图里显示的 Access Key (AK)
const ACCESS_KEY = 'AmNhept4DP43mFgaHBQy4aMnkfmrh984'; // 这里填你截图里的那个 AK

// 🔴 2. 填入你的 Secret Key (SK) - 点击截图里的星号部分查看或重置
const SECRET_KEY = '4dyKrNrNEaKRyBtn9ay4FPdKfFREGaDL';

function generateToken() {
    // 获取当前时间戳 (秒)
    const now = Math.floor(Date.now() / 1000);

    // 构造 Payload
    const payload = {
        iss: ACCESS_KEY,      // 发行者
        exp: now + 1800,      // 过期时间: 30分钟后
        nbf: now - 300        // 生效时间: 倒退5分钟 (防止服务器时间误差导致验证失败)
    };

    // 构造 Header
    const header = {
        alg: "HS256",
        typ: "JWT"
    };

    // 生成签名
    const token = jwt.sign(payload, SECRET_KEY, {
        header: header,
        noTimestamp: true // 建议加上，仅包含 payload 中定义的字段
    });

    return token;
}

try {
    const token = generateToken();
    console.log("\n👇 请复制下面这串字符到网页输入框中：\n");
    console.log(token);
    console.log("\n");
} catch (e) {
    console.error("生成失败:", e);
}
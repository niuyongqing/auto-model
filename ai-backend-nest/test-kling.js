// 文件名: test-kling.js
const jwt = require('jsonwebtoken'); // 确保已安装: npm install jsonwebtoken
const axios = require('axios');      // 确保已安装: npm install axios

// 🔴 🔴 🔴 请务必仔细核对这里的 Key，不要填反！🔴 🔴 🔴
// Access Key ID (通常以 Ak_ 开头)
const ACCESS_KEY = 'AmNhept4DP43mFgaHBQy4aMnkfmrh984';
// Access Key Secret (通常以 Sk_ 开头)
const SECRET_KEY = '4dyKrNrNEaKRyBtn9ay4FPdKfFREGaDL';

// 官方接口地址
const API_URL = 'https://api.klingai.com/v1/videos/image2video';

async function testKlingAuth() {
    console.log("1. 正在生成 JWT Token...");

    // 1. 获取当前时间戳 (秒)
    const now = Math.floor(Date.now() / 1000);

    // 2. 构造 Payload (负荷)
    // ⚠️ 关键点：nbf (Not Before) 必须比当前时间早一点，防止服务器时钟偏差
    const payload = {
        iss: ACCESS_KEY,      // 发行者: 必须是 AccessKey ID
        exp: now + 1800,      // 过期时间: 30分钟后
        nbf: now - 300        // 生效时间: 倒退5分钟 (容错)
    };

    // 3. 构造 Header (头)
    const header = {
        alg: "HS256",
        typ: "JWT"
    };

    try {
        // 4. 生成 Token
        const token = jwt.sign(payload, SECRET_KEY, {
            header: header,
            noTimestamp: true // 🔥 尝试禁用自动生成的 iat 字段，严格匹配官方 Python 示例
        });

        console.log("✅ Token 生成成功:", token.substring(0, 20) + "...");

        // 5. 发起测试请求 (这里故意不传 body，只测鉴权是否通过)
        // 如果鉴权通过但参数缺失，官方通常会返回 400 (Bad Request) 而不是 401 (Unauthorized)
        console.log("2. 正在发送测试请求...");

        await axios.post(API_URL, {}, {
            headers: {
                'Authorization': `Bearer ${token}`, // 注意 Bearer 后面有空格
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        if (error.response) {
            console.log("----------------------------------------");
            console.log(`❌ 状态码: ${error.response.status}`);
            console.log("❌ 返回数据:", JSON.stringify(error.response.data, null, 2));
            console.log("----------------------------------------");

            if (error.response.status === 401) {
                console.error("🚨 依然是 401 鉴权失败！可能原因：");
                console.error("1. AK/SK 填反了（iss 应该是 AccessKey ID）");
                console.error("2. Key 是无效的或已过期");
                console.error("3. 你在用 PiAPI 等代理商的 Key 访问官方接口");
            } else if (error.response.status === 400) {
                console.log("🎉 恭喜！鉴权通过了！(400是预期的，因为我们没传参数)");
            }
        } else {
            console.error("❌ 请求发送失败:", error.message);
        }
    }
}

testKlingAuth();
import { start } from './codex-bridge.mjs';

start().then(() => {
    console.log('已生成本机专用 codex-helper.user.js，请导入油猴并刷新课程播放页。');
    console.log('请保持服务窗口打开；Ctrl+C 可停止服务。');
}).catch(error => {
    console.error(error.code === 'EADDRINUSE' ? '本机端口已被占用，请先关闭旧服务或修改配置端口，再重新生成并安装脚本。' : error.message);
    process.exitCode = 1;
});

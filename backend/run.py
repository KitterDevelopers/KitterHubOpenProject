"""启动脚本：python run.py"""
import uvicorn

if __name__ == "__main__":
    # reload=False：稳定模式，不启动多进程重载器（避免部分环境的命名管道/子进程问题）
    # proxy_headers：信任本机 nginx 写入的 X-Forwarded-For/X-Real-IP，让日志/限流/审计拿到真实客户端 IP
    uvicorn.run(
        "app.main:socket_app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
    )

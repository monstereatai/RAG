#!/bin/bash

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查必要工具
check_requirements() {
    log_info "检查必要工具..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose 未安装"
        exit 1
    fi

    log_success "所有必要工具已安装"
}

# 创建必要的目录
create_directories() {
    log_info "创建必要目录..."

    mkdir -p logs
    mkdir -p docker/nginx/ssl
    mkdir -p docker/mysql/master-init
    mkdir -p docker/mysql/slave-init
    mkdir -p docker/prometheus
    mkdir -p docker/grafana/dashboards
    mkdir -p docker/grafana/datasources

    log_success "目录创建完成"
}

# 生成自签名SSL证书
generate_ssl_cert() {
    log_info "生成自签名SSL证书..."

    SSL_DIR="docker/nginx/ssl"
    KEY_FILE="${SSL_DIR}/key.pem"
    CERT_FILE="${SSL_DIR}/cert.pem"

    if [ ! -f "$KEY_FILE" ] || [ ! -f "$CERT_FILE" ]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$KEY_FILE" \
            -out "$CERT_FILE" \
            -subj "/C=CN/ST=Beijing/L=Beijing/O=Example Inc/OU=Web/CN=localhost"

        log_success "SSL证书生成完成"
    else
        log_warning "SSL证书已存在，跳过生成"
    fi
}

# 初始化数据库
init_database() {
    log_info "等待数据库初始化..."

    # 等待MySQL启动
    sleep 10

    # 检查是否已经初始化
    if [ ! -f "docker/mysql/master-init/.initialized" ]; then
        log_info "创建数据库用户和权限..."

        # 创建主库初始化脚本
        cat > docker/mysql/master-init/init.sql << 'EOF'
CREATE DATABASE IF NOT EXISTS nestjs_enterprise_master;
CREATE DATABASE IF NOT EXISTS nestjs_enterprise_slave;
FLUSH PRIVILEGES;
EOF

        # 创建从库配置文件
        cat > docker/mysql/slave-init/replication.sql << 'EOF'
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='mysql-master',
    SOURCE_PORT=3306,
    SOURCE_USER='root',
    SOURCE_PASSWORD='${DB_PASSWORD}';
START REPLICA;
EOF

        touch docker/mysql/master-init/.initialized
        log_success "数据库初始化完成"
    fi
}

# 构建和启动服务
deploy_docker() {
    log_info "构建和启动Docker服务..."

    # 拉取最新镜像
    docker-compose pull

    # 构建应用镜像
    docker-compose build --no-cache

    # 启动服务
    docker-compose up -d

    log_success "Docker服务启动完成"
}

# 部署Kubernetes（可选）
deploy_kubernetes() {
    if [ "$1" == "--k8s" ]; then
        log_info "部署到Kubernetes..."

        # 应用配置
        kubectl apply -f kubernetes/config/

        # 应用部署
        kubectl apply -f kubernetes/deployment.yaml
        kubectl apply -f kubernetes/service.yaml

        # 等待Pod就绪
        kubectl wait --for=condition=ready pod -l app=nestjs-enterprise -n production

        log_success "Kubernetes部署完成"
    fi
}

# 健康检查
health_check() {
    log_info "执行健康检查..."

    # 检查应用服务
    if curl -f http://localhost:3001/health > /dev/null 2>&1; then
        log_success "应用服务健康检查通过"
    else
        log_error "应用服务健康检查失败"
        exit 1
    fi

    # 检查数据库连接
    if mysqladmin ping --host=localhost --user=root --password=dev_password123 --silent > /dev/null 2>&1; then
        log_success "数据库连接正常"
    else
        log_error "数据库连接失败"
        exit 1
    fi

    log_success "所有服务健康检查通过"
}

# 清理旧版本
cleanup() {
    log_info "清理旧版本..."

    # 停止并删除旧容器
    docker-compose down --remove-orphans

    # 清理Docker镜像
    docker image prune -f

    log_success "清理完成"
}

# 显示状态
show_status() {
    log_info "服务状态："
    docker-compose ps

    echo ""
    log_info "资源使用情况："
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
}

# 主函数
main() {
    log_info "开始部署 NestJS 企业级应用..."

    # 解析命令行参数
    case "$1" in
        "init")
            check_requirements
            create_directories
            generate_ssl_cert
            ;;
        "deploy")
            check_requirements
            deploy_docker
            health_check
            show_status
            ;;
        "deploy-k8s")
            check_requirements
            deploy_docker
            deploy_kubernetes --k8s
            ;;
        "cleanup")
            cleanup
            ;;
        "status")
            show_status
            ;;
        "logs")
            docker-compose logs -f
            ;;
        *)
            echo "使用方法: $0 {init|deploy|deploy-k8s|cleanup|status|logs}"
            echo ""
            echo "  init     - 初始化环境"
            echo "  deploy   - 部署Docker服务"
            echo "  deploy-k8s - 部署到Kubernetes"
            echo "  cleanup  - 清理旧版本"
            echo "  status   - 显示服务状态"
            echo "  logs     - 查看日志"
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
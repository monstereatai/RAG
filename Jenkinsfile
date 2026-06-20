pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    choice(
      name: 'DEPLOY_TARGET',
      choices: ['none', 'staging', 'prod'],
      description: 'Deployment target. Keep "none" for CI-only validation.'
    )
    booleanParam(
      name: 'ENABLE_GRAPHRAG_PROFILE',
      defaultValue: false,
      description: 'Enable docker compose graphrag profile during deployment.'
    )
  }

  environment {
    NPM_CONFIG_REGISTRY = 'https://registry.npmmirror.com/'
    BACKEND_IMAGE = 'rag-backend:ci'
    FRONTEND_IMAGE = 'rag-frontend:ci'
  }

  stages {
    stage('Backend Gate') {
      steps {
        dir('backend') {
          sh 'npm ci --omit=optional --legacy-peer-deps'
          sh 'npm run build'
          sh 'npx eslint "{src,apps,libs,test}/**/*.ts"'
          sh 'npm run eval:rag'
        }
      }
    }

    stage('Frontend Gate') {
      steps {
        dir('frontend') {
          sh 'npm ci'
          sh 'npm run lint'
          sh 'npm run build'
        }
      }
    }

    stage('Docker Build') {
      steps {
        sh 'docker build -t "$BACKEND_IMAGE" backend'
        sh 'docker build -t "$FRONTEND_IMAGE" frontend'
      }
    }

    stage('Deploy') {
      when {
        expression { params.DEPLOY_TARGET != 'none' }
      }
      steps {
        script {
          def composeFile = params.DEPLOY_TARGET == 'prod'
            ? 'docker-compose.prod.yml'
            : 'docker-compose.staging.yml'
          def profileArgs = params.ENABLE_GRAPHRAG_PROFILE ? '--profile graphrag' : ''

          dir('docker') {
            sh "docker compose -f ${composeFile} ${profileArgs} up -d --build"
            sh "docker compose -f ${composeFile} ${profileArgs} ps"
          }
        }
      }
    }
  }

  post {
    always {
      echo "Pipeline finished with DEPLOY_TARGET=${params.DEPLOY_TARGET}"
    }
  }
}

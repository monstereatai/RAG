#!/bin/sh
set -e

if [ "${ENABLE_DATABASE}" = "true" ]; then
  echo "Waiting for database..."
  until mysqladmin ping --host="${DB_HOST}" --user="${DB_USERNAME}" --password="${DB_PASSWORD}" --silent; do
    sleep 1
  done
  echo "Database is ready!"
fi

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  echo "Running TypeORM migrations..."
  npm run migration:run:prod
fi

# 启动应用
echo "Starting application..."
exec "$@"

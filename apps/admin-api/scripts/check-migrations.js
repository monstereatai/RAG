const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataSourcePath = path.join(root, 'src/database/data-source.ts');
const migrationsDir = path.join(root, 'src/database/migrations');
const packageJson = require(path.join(root, 'package.json'));

function fail(message) {
  console.error(`Migration check failed: ${message}`);
  process.exitCode = 1;
}

if (process.env.NODE_ENV === 'production' && process.env.DB_SYNCHRONIZE === 'true') {
  fail('DB_SYNCHRONIZE=true is forbidden in production.');
}

if (!fs.existsSync(dataSourcePath)) {
  fail('src/database/data-source.ts is missing.');
} else {
  const dataSource = fs.readFileSync(dataSourcePath, 'utf8');
  if (!dataSource.includes('synchronize: false')) {
    fail('TypeORM CLI data source must keep synchronize: false.');
  }

  if (!dataSource.includes('migrations:')) {
    fail('TypeORM CLI data source must configure migrations.');
  }
}

if (!fs.existsSync(migrationsDir)) {
  fail('src/database/migrations directory is missing.');
} else {
  const migrations = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.ts'));
  if (migrations.length === 0) {
    fail('at least one baseline migration file is required.');
  }
}

for (const script of ['migration:generate', 'migration:run', 'migration:run:prod', 'migration:revert']) {
  if (!packageJson.scripts?.[script]) {
    fail(`package.json is missing ${script}.`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log('Migration checks passed.');

import React from 'react';
import { useQaOpsController } from './qa-ops-controller';
import { QaOpsView } from './qa-ops-view';

const QaOps: React.FC = () => <QaOpsView {...useQaOpsController()} />;

export default QaOps;

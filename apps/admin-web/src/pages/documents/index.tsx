import React from 'react';
import { useDocumentsController } from './documents-controller';
import type { DocumentListPageProps } from './documents-types';
import { DocumentsView } from './documents-view';

export type { DocumentListPageProps } from './documents-types';

const Documents: React.FC<DocumentListPageProps> = (props) => {
  const controller = useDocumentsController(props);
  return <DocumentsView controller={controller} />;
};

export { Documents };
export default Documents;

import { List } from 'antd';
import React from 'react';
import type { ListItemDataType } from '../../data.d';
import useStyles from './index.style';

const Articles: React.FC = () => {
  const { styles } = useStyles();
  const listData: { list: ListItemDataType[] } = { list: [] };

  return (
    <List<ListItemDataType>
      size="large"
      className={styles.articleList}
      rowKey="id"
      itemLayout="vertical"
      dataSource={listData.list}
      renderItem={(item: any) => (
        <List.Item key={item.id}>
          <List.Item.Meta title={item.title} description={item.content} />
        </List.Item>
      )}
    />
  );
};

export default Articles;

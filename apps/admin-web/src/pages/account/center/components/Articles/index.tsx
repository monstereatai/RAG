import { LikeOutlined, MessageFilled, StarTwoTone } from '@ant-design/icons';
import { Flex, List, Tag } from 'antd';
import React from 'react';
import { ArticleListContent } from '@/components';
import type { ListItemDataType } from '../../data.d';
import useStyles from './index.style';

const IconText: React.FC<{
  icon: React.ReactNode;
  text: React.ReactNode;
}> = ({ icon, text }) => (
  <span>
    {icon} {text}
  </span>
);

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

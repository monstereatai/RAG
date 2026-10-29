import { Card, List } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import React from 'react';

dayjs.extend(relativeTime);

import { AvatarList } from '@/components';
import type { ListItemDataType } from '../../data.d';
import useStyles from './index.style';

const Projects: React.FC = () => {
  const { styles } = useStyles();
  const listData: { list: ListItemDataType[] } = { list: [] };

  return (
    <List<ListItemDataType>
      className={styles.coverCardList}
      rowKey="id"
      grid={{ gutter: 24, xxl: 3, xl: 2, lg: 2, md: 2, sm: 2, xs: 1 }}
      dataSource={listData.list}
      renderItem={(item: any) => (
        <List.Item>
          <Card className={styles.card} hoverable>
            <Card.Meta title={item.title} />
          </Card>
        </List.Item>
      )}
    />
  );
};

export default Projects;

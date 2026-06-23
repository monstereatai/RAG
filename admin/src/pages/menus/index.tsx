import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { Button, Modal, message, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import { deleteMenu, getMenuTree, type MenuItem } from './service';

const Menus: React.FC = () => {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);

  const loadMenus = async () => {
    setLoading(true);
    try {
      const res = await getMenuTree();
      setMenus((res as any)?.data ?? res ?? []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    loadMenus();
  }, []);

  const handleDelete = (record: MenuItem) => {
    Modal.confirm({
      title: `确认删除菜单「${record.name}」？`,
      okType: 'danger',
      onOk: async () => {
        await deleteMenu(record.id);
        message.success('删除成功');
        loadMenus();
      },
    });
  };

  const columns: ColumnsType<MenuItem> = [
    { title: '菜单名', dataIndex: 'name', width: 180 },
    { title: '路径', dataIndex: 'path', width: 200 },
    { title: '图标', dataIndex: 'icon', width: 100 },
    { title: '排序', dataIndex: 'sort', width: 80 },
    {
      title: '可见',
      dataIndex: 'visible',
      width: 80,
      render: (v: boolean) =>
        v ? <Tag color="success">是</Tag> : <Tag color="default">否</Tag>,
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          新建菜单
        </Button>
      </div>

      <Table<MenuItem>
        rowKey="id"
        columns={columns}
        dataSource={menus}
        loading={loading}
        pagination={false}
        expandable={{ defaultExpandAllRows: true }}
      />

      <ModalForm
        title="新建菜单"
        open={createModalVisible}
        onOpenChange={setCreateModalVisible}
        onFinish={async () => {
          message.success('创建成功');
          setCreateModalVisible(false);
          loadMenus();
          return true;
        }}
      >
        <ProFormText name="name" label="菜单名" rules={[{ required: true }]} />
        <ProFormText name="path" label="路径" rules={[{ required: true }]} />
        <ProFormText name="icon" label="图标" />
        <ProFormDigit name="sort" label="排序" initialValue={0} />
        <ProFormSwitch name="visible" label="可见" />
      </ModalForm>
    </PageContainer>
  );
};

export default Menus;

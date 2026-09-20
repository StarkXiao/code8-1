import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Button, Empty, Form, Input, Modal, Spin, Tabs, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { ROLE_LABELS } from '@froa/shared';

export function WorkspaceListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [createForm] = Form.useForm<{ name: string }>();
  const [joinForm] = Form.useForm<{ inviteCode: string }>();

  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: workspaceApi.list });

  const createMutation = useMutation({
    mutationFn: (name: string) => workspaceApi.create(name),
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setCreating(false);
      createForm.resetFields();
      navigate(`/w/${workspace.id}`);
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const joinMutation = useMutation({
    mutationFn: (inviteCode: string) => workspaceApi.join(inviteCode),
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setJoining(false);
      joinForm.resetFields();
      navigate(`/w/${workspace.id}`);
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  if (workspaces.isLoading) {
    return (
      <div className="froa-center-page">
        <Spin size="large" />
      </div>
    );
  }

  const list = workspaces.data ?? [];

  return (
    <div>
      <div className="froa-page-title">
        <div>
          <h1>我的家庭空间</h1>
          <div className="froa-hint">
            一个家庭空间就是一份独立的食谱档案：成员、语音、版本都互相隔离。
          </div>
        </div>
        <div className="froa-row">
          <Button icon={<PlusOutlined />} onClick={() => setJoining(true)}>
            用邀请码加入
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            创建家庭空间
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty
          description={
            <span>
              还没有家庭空间。
              <br />
              先创建一个，然后录下长辈的第一段口述。
            </span>
          }
        />
      ) : (
        <div className="froa-grid">
          {list.map((workspace) => (
            <div
              key={workspace.id}
              className="froa-card"
              onClick={() => navigate(`/w/${workspace.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => event.key === 'Enter' && navigate(`/w/${workspace.id}`)}
            >
              <h3 className="froa-card-title">{workspace.name}</h3>
              <div className="froa-item-meta">
                <span>我的角色：{ROLE_LABELS[workspace.role]}</span>
              </div>
              <div className="froa-stat-row">
                <span className="froa-stat">
                  邀请码 <strong>{workspace.inviteCode}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        forceRender
        open={creating}
        title="创建家庭空间"
        onCancel={() => setCreating(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMutation.isPending}
        okText="创建"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical" onFinish={(v) => createMutation.mutate(v.name)}>
          <Form.Item
            label="空间名称"
            name="name"
            rules={[{ required: true, message: '请填写空间名称' }]}
          >
            <Input size="large" placeholder="我们家的厨房" />
          </Form.Item>
          <Typography.Text type="secondary">
            创建后你就是所有者，可以邀请家人并设置他们的角色。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        forceRender
        open={joining}
        title="用邀请码加入"
        onCancel={() => setJoining(false)}
        footer={null}
      >
        <Tabs
          items={[
            {
              key: 'code',
              label: '输入邀请码',
              children: (
                <Form form={joinForm} layout="vertical" onFinish={(v) => joinMutation.mutate(v.inviteCode)}>
                  <Form.Item
                    label="邀请码"
                    name="inviteCode"
                    rules={[{ required: true, message: '请填写邀请码' }]}
                  >
                    <Input size="large" placeholder="例如 HOME2026" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={joinMutation.isPending}>
                    加入
                  </Button>
                </Form>
              ),
            },
            {
              key: 'link',
              label: '邀请链接怎么用',
              children: (
                <Typography.Paragraph type="secondary">
                  家人把形如 <code>/join/HOME2026</code> 的链接发给你，直接打开即可自动加入。
                </Typography.Paragraph>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}

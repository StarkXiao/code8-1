import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { errorMessage } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: { email: string; password: string; displayName: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await register(values.email, values.password, values.displayName);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="froa-center-page">
      <div className="froa-auth-card">
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          注册
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          注册后创建一个"家庭空间"，再用邀请码把家人都拉进来。
        </Typography.Paragraph>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            label="你的称呼"
            name="displayName"
            rules={[{ required: true, message: '请填写称呼，比如"我"或"小张"' }]}
          >
            <Input size="large" placeholder="我" />
          </Form.Item>

          <Form.Item
            label="邮箱"
            name="email"
            rules={[{ required: true, type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input size="large" placeholder="you@example.com" />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}
          >
            <Input.Password size="large" />
          </Form.Item>

          <Button type="primary" size="large" htmlType="submit" block loading={submitting}>
            注册并继续
          </Button>
        </Form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          已经有账号？<Link to="/login">去登录</Link>
        </div>
      </div>
    </div>
  );
}

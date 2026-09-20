import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { errorMessage } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: { email: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
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
          家庭食谱口述整理器
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          把家人说的"火候差不多""放一点点糖"，整理成别人也能照着做出来的食谱。
        </Typography.Paragraph>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false} autoComplete="on">
          <Form.Item
            label="邮箱"
            name="email"
            rules={[{ required: true, type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input size="large" placeholder="you@example.com" autoComplete="username" />
          </Form.Item>

          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>

          <Button type="primary" size="large" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          还没有账号？<Link to="/register">注册一个</Link>
        </div>
      </div>
    </div>
  );
}

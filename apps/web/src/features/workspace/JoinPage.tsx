import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Result, Spin } from 'antd';
import { workspaceApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';

/** 通过邀请链接加入家庭空间：/join/:inviteCode */
export function JoinPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const join = async () => {
    if (!inviteCode) return;
    setJoining(true);
    setError(null);
    try {
      const workspace = await workspaceApi.join(inviteCode);
      navigate(`/w/${workspace.id}`, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setJoining(false);
    }
  };

  useEffect(() => {
    void join();
    // 邀请码变化时重新加入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode]);

  if (joining) {
    return (
      <div className="froa-center-page">
        <Spin size="large" fullscreen tip="正在加入家庭空间…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="froa-center-page">
        <Result
          status="warning"
          title="加入失败"
          subTitle={error}
          extra={
            <Button type="primary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="froa-center-page">
      <Alert type="info" message="正在处理邀请…" />
    </div>
  );
}

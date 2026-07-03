#include<bits/stdc++.h>
using namespace std;
int n,m,a[100005],x,y;
int main(){
	cin>>n;
	for(int i=1;i<=n;i++) cin>>a[i];
	cin>>m;
	while(m--){
		cin>>x>>y;
		int maxn=-1,ans=0;
		for(int i=x;i<=y;i++){
			if(a[i]>maxn){
				maxn=a[i];ans=i;
			}
		}
		cout<<ans<<'\n';
	}
	return 0;
}

